import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConversationControlService } from "./brain/conversation-control.service";
import { DeterministicTimeService } from "./brain/deterministic-time.service";
import { ActionPolicyService } from "./brain/action-policy.service";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { ToolLoopService } from "./brain/tool-loop.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimBrainDecision } from "./domain/nadim-brain-decision";
import { initialNadimState, NadimState } from "./domain/nadim-state";
import { NadimV2Service } from "./nadim-v2.service";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { NadimConversationService } from "./persistence/nadim-conversation.service";

function state(overrides: Partial<NadimState> = {}) {
  return { ...initialNadimState({ channel: "WEB", locale: "ar-EG" }), ...overrides };
}

function decision(overrides: Partial<NadimBrainDecision> = {}): NadimBrainDecision {
  return {
    understood: true,
    understoodMeaning: "The customer is continuing a normal service conversation.",
    conversationalGoal: "RESPOND_HELPFULLY_TO_THE_CURRENT_TURN",
    responsePlan: ["Acknowledge the meaning", "Answer briefly in the established style"],
    conversationalType: "CONVERSATION",
    intent: null,
    references: [],
    proposedStateOperations: [],
    proposedToolCalls: [],
    proposedActions: [],
    customerContextUpdates: {},
    stateQueries: [],
    responseStyleRequest: null,
    needsClarification: false,
    clarificationReason: null,
    locale: "ar-EG",
    recentContextUsed: false,
    confidence: 0.94,
    ...overrides,
  };
}

function dialogueDecision(value: NadimBrainDecision, reply = "تمام، فاهمك.") {
  const calls = { decide: 0, compose: 0, legacyUnderstand: 0 };
  return {
    calls,
    available: () => true,
    decide: async () => {
      calls.decide += 1;
      return { value, provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, fallbackStage: "NONE", latencyMs: 3, attempts: [] };
    },
    understand: async () => { calls.legacyUnderstand += 1; throw new Error("legacy understanding must not run"); },
    compose: async () => {
      calls.compose += 1;
      return { value: reply, provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, fallbackStage: "NONE", latencyMs: 2, attempts: [] };
    },
  };
}

test("the public understanding path is AI-first and intent remains optional metadata", async () => {
  const model = dialogueDecision(decision({
    understoodMeaning: "The customer is cautiously thinking aloud and wants reassurance, not a property search.",
    conversationalGoal: "REASSURE_WITHOUT_FORCING_DISCOVERY",
    responsePlan: ["Validate the hesitation", "Offer to continue at the customer's pace"],
    conversationalType: "REACTION",
  }));
  const result = await new UnderstandingService(model as any).understand("حاسس إني محتاج أفكر بصوت عالي شوية", state());
  assert.equal(model.calls.decide, 1);
  assert.equal(model.calls.legacyUnderstand, 0);
  assert.equal(result.understanding.intent, "CONVERSATION");
  assert.equal(result.understanding.classificationSource, "MODEL_SEMANTIC");
  assert.deepEqual(result.understanding.responsePlan, ["Validate the hesitation", "Offer to continue at the customer's pace"]);
  assert.deepEqual(result.understanding.proposedToolCalls, []);
});

test("multi-goal decisions combine capability, language, and search without an intent bottleneck", async () => {
  const model = dialogueDecision(decision({
    understoodMeaning: "The customer asks what Nadim can do, requests English, and asks for a verified apartment search.",
    conversationalGoal: "ANSWER_CAPABILITY_BRIEFLY_THEN_SEARCH_AND_REPLY_IN_ENGLISH",
    responsePlan: ["Briefly explain the real-estate role", "Use the explicit English preference", "Present only verified search output"],
    conversationalType: "STRUCTURED_REQUEST",
    intent: "PROPERTY_SEARCH",
    proposedStateOperations: [
      { operation: "SET", field: "propertyTypes", value: ["Apartment"] },
      { operation: "SET", field: "locations", value: ["New Cairo"] },
      { operation: "SET", field: "bedrooms", value: 2 },
    ],
    proposedToolCalls: [{ tool: "PROPERTY_SEARCH", arguments: { limit: 5 }, reason: "Verified inventory is required" }],
  }));
  const understood = (await new UnderstandingService(model as any).understand("What can you do? Answer in English and show me two-bedroom apartments in New Cairo", state())).understanding;
  const next = new StateEngineService().apply(state(), understood, { channel: "WEB" });
  const plan = new PlannerService().plan(understood, next);
  assert.equal(understood.intent, "PROPERTY_SEARCH");
  assert.equal(understood.responsePlan?.length, 3);
  assert.equal(plan.steps[0].tool, "PROPERTY_SEARCH");
  assert.deepEqual(next.search.locations, ["New Cairo"]);
});

test("multiple memory questions read deterministic state without inventory", async () => {
  const model = dialogueDecision(decision({
    understoodMeaning: "The customer asks for the current budget, bedrooms, and location.",
    conversationalGoal: "SUMMARIZE_THREE_CURRENT_SEARCH_VALUES",
    responsePlan: ["Read budget, bedrooms, and location from deterministic state"],
    conversationalType: "STRUCTURED_REQUEST",
    intent: "CURRENT_SEARCH_QUERY",
    stateQueries: ["budgetMax", "bedrooms", "locations"],
  }));
  const current = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000 } });
  const understood = (await new UnderstandingService(model as any).understand("فكرني بالميزانية والغرف والمكان", current)).understanding;
  const plan = new PlannerService().plan(understood, current);
  assert.deepEqual(understood.stateQueries, ["budgetMax", "bedrooms", "locations"]);
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(understood.operations, []);
});

test("the bounded loop feeds verified output back to AI and stops after two tools", async () => {
  const executed: string[] = [];
  let continuationInput: any;
  const toolExecutor: any = {
    execute: async (plan: any) => {
      const tool = plan.steps[0].tool;
      executed.push(tool);
      return [{ tool, ok: true, data: tool === "PROPERTY_SEARCH" ? [{ id: "unit-1" }] : { id: "unit-1", price: 7_500_000 }, latencyMs: 1 }];
    },
  };
  const continuation = decision({
    conversationalGoal: "PRESENT_THE_VERIFIED_UNIT_WITH_PRICE",
    responsePlan: ["Use the verified price"],
    conversationalType: "STRUCTURED_REQUEST",
    proposedToolCalls: [{ tool: "GET_UNIT_FACTS", arguments: { unitId: "unit-1" }, reason: "Verified facts are needed" }],
  });
  const dialogue: any = {
    available: () => true,
    continueAfterTools: async (input: any) => {
      continuationInput = input;
      return { value: continuation, provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, latencyMs: 2, attempts: [] };
    },
  };
  const loop = await new ToolLoopService(toolExecutor, dialogue).run(
    { goal: "SEARCH_THEN_EXPLAIN", steps: [{ tool: "PROPERTY_SEARCH", arguments: { limit: 5 } }] },
    state(),
    decision({ proposedToolCalls: [{ tool: "PROPERTY_SEARCH", arguments: { limit: 5 }, reason: "Search requested" }] }),
    {},
  );
  assert.deepEqual(executed, ["PROPERTY_SEARCH", "GET_UNIT_FACTS"]);
  assert.equal(loop.iterations, 2);
  assert.equal(continuationInput.verifiedToolResults[0].ok, true);
  assert.equal(loop.finalDecision?.conversationalGoal, "PRESENT_THE_VERIFIED_UNIT_WITH_PRICE");
});

test("deterministic time uses a known customer timezone and refuses to guess an unknown one", () => {
  const time = new DeterministicTimeService();
  const instant = new Date("2026-08-29T10:00:00.000Z");
  const egypt = time.now("ar-EG", undefined, instant);
  assert.equal(egypt.timeZone, "Africa/Cairo");
  assert.equal(egypt.iso, instant.toISOString());
  assert.throws(() => time.now("ar", undefined, instant), (error: any) => error.code === "TIMEZONE_REQUIRED");
});

test("handoff, explicit AI return, and deletion confirmation are persisted controls", async () => {
  const calls: Array<[string, unknown]> = [];
  const controls = new ConversationControlService({
    setMode: async (_id: string, mode: string) => { calls.push(["mode", mode]); },
    requestDeletion: async () => { calls.push(["deletion", "pending"]); },
  } as any);
  const handoff = await controls.apply({ conversationId: "c1", mode: "AI", command: "REQUEST_HUMAN_HANDOFF", hasIdempotencyKey: true });
  assert.equal(handoff.mode, "HUMAN");
  assert.equal(handoff.executed?.status, "SUCCEEDED");
  const returnToAi = await controls.apply({ conversationId: "c1", mode: "HUMAN", command: "RETURN_TO_AI", hasIdempotencyKey: true });
  assert.equal(returnToAi.mode, "AI");
  const requested = await controls.apply({ conversationId: "c1", mode: "AI", command: "REQUEST_CONVERSATION_DELETION", hasIdempotencyKey: true });
  assert.equal(requested.deleteConfirmed, false);
  const confirmed = await controls.apply({ conversationId: "c1", mode: "AI", command: "CONFIRM_CONVERSATION_DELETION", pendingDeletion: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, hasIdempotencyKey: true });
  assert.equal(confirmed.deleteConfirmed, true);
  const unsafe = await controls.apply({ conversationId: "c1", mode: "AI", command: "CONFIRM_CONVERSATION_DELETION", pendingDeletion: { expiresAt: new Date(Date.now() + 60_000).toISOString() }, hasIdempotencyKey: false });
  assert.equal(unsafe.executed?.errorCode, "IDEMPOTENCY_KEY_REQUIRED");
  assert.deepEqual(calls, [["mode", "HUMAN"], ["mode", "AI"], ["deletion", "pending"]]);
});

test("confirmed deletion writes an idempotent receipt then removes only web and Nadim conversation data", async () => {
  const operations: string[] = [];
  const transaction: any = {
    nadimConversation: {
      findUnique: async () => ({ id: "nadim-c", webConversations: [{ id: "web-c" }] }),
      delete: async () => { operations.push("delete-nadim"); },
    },
    nadimDeletionReceipt: { create: async () => { operations.push("receipt"); } },
    conversation: { deleteMany: async () => { operations.push("delete-web"); } },
    customer: { delete: async () => { throw new Error("customer must be preserved"); } },
    lead: { delete: async () => { throw new Error("lead must be preserved"); } },
  };
  const service = new NadimConversationService({ $transaction: async (callback: any) => callback(transaction) } as any);
  await service.deleteConfirmed({
    conversationId: "nadim-c",
    channel: "WEB",
    idempotencyKey: "delete-event-1",
    requestHash: "hash-1",
    response: { ok: true, version: "v2", replayed: false, conversationId: "nadim-c", reply: "deleted", suppressReply: false, mode: "AI", deleted: true } as any,
  });
  assert.deepEqual(operations, ["receipt", "delete-web", "delete-nadim"]);
});

test("a successful control action cannot authorize an unrelated success claim", async () => {
  const model: any = {
    available: () => true,
    compose: async () => ({ value: "Your viewing is booked and confirmed.", provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, latencyMs: 1, attempts: [] }),
  };
  const understanding: any = { intent: "CONVERSATION", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
  const result = await new ResponseComposerService(model).compose({
    userMessage: "confirm delete",
    understanding,
    state: state(),
    plan: { goal: "CONFIRM_CONVERSATION_DELETION", steps: [] },
    toolResults: [],
    proposedActions: [],
    executedActions: [{ type: "CONFIRM_CONVERSATION_DELETION", status: "SUCCEEDED" }],
  });
  assert.doesNotMatch(result.reply, /booked|viewing/iu);
  assert.match(result.reply, /حذف|deleted|etmasa7/iu);
});

test("unsupported model-proposed actions are surfaced as not executed and never reach automation", async () => {
  let automationCalls = 0;
  const policy = new ActionPolicyService({ execute: async () => { automationCalls += 1; throw new Error("must not execute"); } } as any);
  const understanding: any = {
    intent: "CONVERSATION",
    confidence: 0.96,
    operations: [],
    ordinalReferences: [],
    actionRequested: false,
    proposedActions: [{ type: "RECORD_INTEREST", reason: "Customer expressed interest", payload: {} }],
  };
  const proposed = policy.propose(understanding, state());
  const executed = await policy.execute(proposed, { channel: "WEB", conversationId: "c1", requestId: "event-1" });
  assert.equal(proposed[0].type, "RECORD_INTEREST");
  assert.equal(executed[0].status, "NOT_EXECUTED");
  assert.equal(executed[0].errorCode, "ACTION_NOT_SUPPORTED");
  assert.equal(automationCalls, 0);
});

test("HUMAN-owned inbound permits only a control decision, then persists and suppresses tools and composition", async () => {
  const previous = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  let persisted: any;
  let brainCalls = 0;
  const conversations: any = {
    resolve: async () => ({ conversation: { id: "human-c", mode: "HUMAN" }, mode: "HUMAN", state: state(), conversationContext: { mode: "HUMAN", stage: "DISCOVERY", recentTurns: [] } }),
    persist: async (input: any) => { persisted = input; },
  };
  const service = new NadimV2Service(
    conversations,
    { understand: async () => {
      brainCalls += 1;
      return {
        understanding: { intent: "CONVERSATION", confidence: 0.94, operations: [], ordinalReferences: [], actionRequested: false },
        brainDecision: decision({ proposedActions: [] }),
        model: { provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, latencyMs: 1 },
        providerLatencyMs: 1,
      };
    } } as any,
    new StateEngineService(),
    new PlannerService(),
    { execute: async () => { throw new Error("must not execute tools"); } } as any,
    { propose: () => [], execute: async () => [] } as any,
    { compose: async () => { throw new Error("must not compose"); } } as any,
  );
  try {
    const result = await service.turn({ channel: "WHATSAPP", message: "لسه مستني الموظف" }, "human-owned");
    assert.equal(result.suppressReply, true);
    assert.equal(result.reply, "");
    assert.equal(result.mode, "HUMAN");
    assert.equal(brainCalls, 1);
    assert.equal(persisted.assistantReply, "");
    assert.equal(persisted.plan.goal, "SUPPRESS_AI_REPLY");
  } finally {
    if (previous === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = previous;
  }
});

test("an explicit natural-language request can deterministically return HUMAN ownership to Nadim", async () => {
  const previous = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  let persisted: any;
  let controlInput: any;
  const returnDecision = decision({
    understoodMeaning: "The customer explicitly asks Nadim to resume the conversation.",
    conversationalGoal: "RETURN_CONVERSATION_TO_NADIM",
    responsePlan: ["Acknowledge the successful ownership return briefly"],
    proposedActions: [{ type: "RETURN_TO_AI", reason: "Explicit customer request", payload: {} }],
    confidence: 0.97,
  });
  const model = dialogueDecision(returnDecision, "أنا رجعت معاك.");
  const conversations: any = {
    resolve: async () => ({ conversation: { id: "human-c", mode: "HUMAN" }, mode: "HUMAN", state: state(), conversationContext: { mode: "HUMAN", stage: "DISCOVERY", recentTurns: [] } }),
    persist: async (input: any) => { persisted = input; },
  };
  const controls: any = {
    apply: async (input: any) => {
      controlInput = input;
      return { action: "RETURN_TO_AI", executed: { type: "RETURN_TO_AI", status: "SUCCEEDED" }, mode: "AI", suppressReply: false, deleteConfirmed: false };
    },
  };
  const service = new NadimV2Service(
    conversations,
    new UnderstandingService(model as any),
    new StateEngineService(),
    new PlannerService(),
    { execute: async () => [] } as any,
    { propose: () => [], execute: async () => [] } as any,
    new ResponseComposerService(model as any),
    new LanguageStyleDetectorService(),
    undefined,
    controls,
  );
  try {
    const result = await service.turn({ channel: "WHATSAPP", message: "رجّع نديم يكمل" }, "return-to-ai");
    assert.equal(controlInput.mode, "HUMAN");
    assert.equal(controlInput.understanding.proposedActions[0].type, "RETURN_TO_AI");
    assert.equal(result.mode, "AI");
    assert.equal(result.suppressReply, false);
    assert.equal(result.executedActions[0].status, "SUCCEEDED");
    assert.equal(persisted.plan.goal, "RETURN_TO_AI");
  } finally {
    if (previous === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = previous;
  }
});

test("twenty unseen conversational turns remain useful without inventory", async () => {
  const messages = [
    "الموضوع محيرني شوية", "لسه بجمع الصورة", "أنا شغلي ساعات طويلة", "وعندي طفلين", "الهدوء مهم عندي",
    "مش مستعجل على القرار", "خلينا نفكر واحدة واحدة", "إيه اللي فهمته عني لحد دلوقتي؟", "تمام كده", "أنا عادة بحب أشوف البدائل",
    "بس مش عايز كلام كتير", "خليك مباشر", "طب لو غيرت رأيي بعدين؟", "مفهوم", "أنا قلقان من الالتزام الطويل",
    "مش بطلب خطة دفع دلوقتي", "بس افتكر النقطة دي", "إنت شايف نبدأ منين؟", "سيبها مفتوحة النهارده", "نكمل بكرة",
  ];
  const replies = [
    "ولا يهمك، نرتبها بهدوء.", "تمام، ناخد الصورة جزء جزء.", "فاهم، وقتك عامل مهم.", "تمام، هافتكر إن احتياجات الأسرة مهمة.", "واضح إن الهدوء أولوية ليك.",
    "مفيش استعجال، نمشي بالسرعة المناسبة ليك.", "متفقين، خطوة خطوة.", "فاهم إن وقتك محدود، عندك طفلين، والهدوء مهم ليك.", "تمام.", "حلو، لما نوصل للاختيارات نعرض بدائل واضحة.",
    "وصلت، هخلي كلامي مختصر.", "تمام، هكون مباشر.", "عادي جدًا، أي تفضيل نقدر نراجعه لما تطلب.", "تمام.", "فاهم قلقك من الالتزام الطويل.",
    "واضح، مش هافترض إنك طلبت تفاصيل سداد.", "هفضل واخدها في الاعتبار كسياق، مش كطلب بحث.", "نبدأ بتحديد الهدف من الشراء لما تكون جاهز.", "تمام، نخلي الموضوع مفتوح.", "أكيد، نكمل من هنا بكرة.",
  ];
  let index = 0;
  let current = state();
  const customerContext: Record<string, unknown> = {};
  const model: any = {
    available: () => true,
    decide: async () => {
      const turn = index;
      return { value: decision({
        understoodMeaning: `A meaningful conversational turn ${turn + 1}.`,
        conversationalGoal: turn === 7 ? "SUMMARIZE_CUSTOMER_CONTEXT" : "CONTINUE_THE_CUSTOMER_SERVICE_CONVERSATION",
        responsePlan: [turn === 7 ? "Use persisted customer context" : "Respond briefly and naturally"],
        conversationalType: turn === 8 || turn === 13 ? "ACKNOWLEDGEMENT" : "CONVERSATION",
        customerContextUpdates: turn === 2 ? { workSchedule: "long hours" } : turn === 3 ? { children: 2 } : turn === 4 ? { quietAreaImportant: true } : {},
        references: turn === 7 ? [{ expression: "فهمته عني", resolvedAs: "CUSTOMER_CONTEXT", confidence: 0.96 }] : [],
        recentContextUsed: turn >= 3,
      }), provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, fallbackStage: "NONE", latencyMs: 1, attempts: [] };
    },
    compose: async () => ({ value: replies[index++], provider: "bedrock-glm", model: "zai.glm-5", fallbackUsed: false, fallbackStage: "NONE", latencyMs: 1, attempts: [] }),
  };
  const understander = new UnderstandingService(model);
  const composer = new ResponseComposerService(model);
  const planner = new PlannerService();
  const stateEngine = new StateEngineService();
  const detector = new LanguageStyleDetectorService();
  const produced: string[] = [];
  for (const message of messages) {
    const styled = detector.apply(current, message);
    const understood = (await understander.understand(message, styled, {}, { mode: "AI", stage: "DISCOVERY", recentTurns: [], customerContext })).understanding;
    Object.assign(customerContext, understood.customerContextUpdates);
    const next = stateEngine.apply(styled, understood, { channel: "WEB" });
    const plan = planner.plan(understood, next);
    const composed = await composer.compose({ userMessage: message, understanding: understood, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });
    assert.notEqual(understood.intent, "UNKNOWN", message);
    assert.deepEqual(plan.steps, [], message);
    assert.deepEqual(next.search, current.search, message);
    produced.push(composed.reply);
    current = next;
  }
  assert.equal(produced.length, 20);
  assert.equal(customerContext.children, 2);
  assert.equal(customerContext.quietAreaImportant, true);
  assert.match(produced[7], /وقتك|طفلين|الهدوء/u);
  assert.doesNotMatch(produced.join(" "), /مش فاهم قصدك|مخزون|نتائج بحث/u);
});
