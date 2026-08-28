import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimConversationContext } from "./domain/nadim-conversation-context";
import { NadimSemanticInterpretation } from "./domain/nadim-intent";
import { initialNadimState, NadimState } from "./domain/nadim-state";
import { NadimV2Service } from "./nadim-v2.service";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";

const planner = new PlannerService();
const stateEngine = new StateEngineService();
const detector = new LanguageStyleDetectorService();

function state(overrides: Partial<NadimState> = {}) {
  return { ...initialNadimState({ channel: "WEB", locale: "ar-EG" }), ...overrides };
}

function semantic(overrides: Partial<NadimSemanticInterpretation> = {}): NadimSemanticInterpretation {
  return {
    understood: true,
    understoodMeaning: "The customer is continuing an ordinary real-estate service conversation.",
    responseGoal: "RESPOND_NATURALLY_AND_CONTINUE_THE_CURRENT_TOPIC",
    conversationalType: "CONVERSATION",
    proposedIntent: null,
    proposedStateOperations: [],
    references: [],
    toolNeed: { required: false },
    clarification: { required: false },
    confidence: 0.91,
    locale: "ar-EG",
    stateQuery: null,
    ordinalReferences: [],
    unitReference: null,
    projectReference: null,
    recentContextUsed: false,
    ...overrides,
  };
}

function dialogue(value: NadimSemanticInterpretation, reply = "تمام، أنا معاك ونكمّل من هنا.") {
  const calls = { understand: 0, compose: 0, context: undefined as NadimConversationContext | undefined };
  return {
    calls,
    available: () => true,
    understand: async (_message: string, _state: NadimState, context?: NadimConversationContext) => {
      calls.understand += 1;
      calls.context = context;
      return { value, provider: "groq", model: "semantic-fixture", fallbackUsed: false, latencyMs: 1 };
    },
    compose: async () => {
      calls.compose += 1;
      return { value: reply, provider: "groq", model: "composition-fixture", fallbackUsed: false, latencyMs: 1 };
    },
  };
}

async function runConversation(input: {
  message: string;
  interpretation: NadimSemanticInterpretation;
  reply?: string;
  previous?: NadimState;
  context?: NadimConversationContext;
}) {
  const previous = input.previous ?? state();
  const styled = detector.apply(previous, input.message);
  const model = dialogue(input.interpretation, input.reply);
  const understood = await new UnderstandingService(model as any).understand(input.message, styled, {}, input.context);
  const next = stateEngine.apply(styled, understood.understanding, { channel: "WEB" });
  const plan = planner.plan(understood.understanding, next);
  const composed = await new ResponseComposerService(model as any).compose({
    userMessage: input.message,
    understanding: understood.understanding,
    state: next,
    plan,
    toolResults: [],
    proposedActions: [],
    executedActions: [],
    conversationContext: input.context,
  });
  return { previous, next, plan, understood, composed, model };
}

test("semantic interpretation handles the observed greeting continuation without a phrase rule or intent enum", async () => {
  const previous = state({ revision: 2 });
  const context: NadimConversationContext = {
    stage: "DISCOVERY",
    recentTurns: [{ user: "صباح الخير", assistant: "صباح النور.", intent: "GREETING", tools: [] }],
  };
  const result = await runConversation({
    message: "صباح الفل",
    previous,
    context,
    interpretation: semantic({
      understoodMeaning: "A warm morning greeting continuing the immediately preceding greeting.",
      responseGoal: "RETURN_THE_WARM_GREETING_BRIEFLY",
      conversationalType: "CONVERSATION",
      recentContextUsed: true,
      confidence: 0.97,
    }),
    reply: "صباح النور والفل، يومك جميل.",
  });

  assert.equal(result.model.calls.understand, 1);
  assert.equal(result.model.calls.context?.recentTurns.length, 1);
  assert.equal(result.understood.model?.provider, "groq");
  assert.equal(result.understood.understanding.intent, "CONVERSATION");
  assert.equal(result.understood.understanding.classificationSource, "MODEL_SEMANTIC");
  assert.equal(result.understood.understanding.recentContextUsed, true);
  assert.deepEqual(result.plan.steps, []);
  assert.deepEqual(result.next.search, result.previous.search);
  assert.doesNotMatch(result.composed.reply, /(?:مش فاهم|ما فهمت|لم أفهم)/u);
});

test("unseen conversational equivalents generalize semantically with no tools or state mutation", async () => {
  const context: NadimConversationContext = {
    stage: "ACTIVE_SEARCH",
    recentTurns: [{ user: "محتاج أفهم البدائل", assistant: "أقدر أوضحها واحدة واحدة.", intent: "CONVERSATION", tools: [] }],
  };
  const previous = state({
    revision: 4,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], budgetMax: 8_000_000 },
    lastResultIds: ["unit-1", "unit-2"],
  });
  const cases = [
    { message: "نهارك سعيد", type: "CONVERSATION" as const, goal: "RETURN_A_FRIENDLY_DAYTIME_GREETING", reply: "وإنت يومك أسعد." },
    { message: "الدنيا معاك ماشية؟", type: "CONVERSATION" as const, goal: "ANSWER_BRIEF_PERSONAL_SMALL_TALK", reply: "تمام الحمد لله، وإنت أخبارك؟" },
    { message: "وصلت الفكرة", type: "ACKNOWLEDGEMENT" as const, goal: "ACKNOWLEDGE_BRIEFLY", reply: "تمام، كده إحنا على نفس الصفحة." },
    { message: "حاسس إني تايه شوية", type: "REACTION" as const, goal: "REASSURE_AND_SIMPLIFY_THE_NEXT_STEP", reply: "ولا يهمك، ناخدها خطوة خطوة." },
    { message: "مش مقتنع أوي", type: "REACTION" as const, goal: "ACKNOWLEDGE_DISAGREEMENT_AND_INVITE_THE_KEY_CONCERN", reply: "مفهوم، قولّي أكتر حاجة مش مريحاك." },
    { message: "طب وضّح النقطة الأخيرة", type: "CONVERSATION" as const, goal: "EXPLAIN_THE_RECENT_POINT_USING_DIALOGUE_CONTEXT", reply: "أكيد، المقصود إننا لسه بنرتب الأولويات قبل ما نغيّر البحث." },
    { message: "أنا كنت بفكر لو...", type: "CONVERSATION" as const, goal: "LET_THE_CUSTOMER_FINISH_THE_INCOMPLETE_THOUGHT", reply: "كمّل فكرتك، أنا متابعك." },
    { message: "هو ينفغ نكمل من حتة امبارح", type: "CONVERSATION" as const, goal: "RESUME_FROM_RECENT_CONTEXT_DESPITE_TYPOS", reply: "ينفع طبعًا، نكمّل من آخر نقطة وقفنا عندها." },
  ];

  for (const item of cases) {
    const result = await runConversation({
      message: item.message,
      previous,
      context,
      interpretation: semantic({
        understoodMeaning: `A meaningful ${item.type.toLowerCase()} turn in the current discussion.`,
        responseGoal: item.goal,
        conversationalType: item.type,
        recentContextUsed: item.message.includes("الأخيرة") || item.message.includes("امبارح"),
      }),
      reply: item.reply,
    });
    assert.equal(result.understood.understanding.intent, "CONVERSATION", item.message);
    assert.notEqual(result.understood.understanding.intent, "UNKNOWN", item.message);
    assert.deepEqual(result.plan.steps, [], item.message);
    assert.deepEqual(result.next.search, previous.search, item.message);
    assert.equal(result.next.selectedUnitId, undefined, item.message);
    assert.doesNotMatch(result.composed.reply, /(?:مش فاهم|ما فهمت|لم أفهم)/u, item.message);
  }
});

test("semantic discovery can collect preferences without prematurely running inventory", async () => {
  const opening = await runConversation({
    message: "نفسي أملك بس لسه الصورة مش واضحة",
    interpretation: semantic({
      understoodMeaning: "The customer wants to own property but needs guided discovery.",
      responseGoal: "ASK_ONE_USEFUL_DISCOVERY_QUESTION",
      conversationalType: "DISCOVERY",
    }),
    reply: "نبدأ بالأسهل: بتدور على بيت تسكن فيه ولا للاستثمار؟",
  });
  assert.equal(opening.understood.understanding.intent, "CONVERSATION");
  assert.deepEqual(opening.plan.steps, []);

  const purpose = await runConversation({
    message: "للسكن",
    previous: opening.next,
    interpretation: semantic({
      understoodMeaning: "The customer says the property purpose is personal living.",
      responseGoal: "ACKNOWLEDGE_PURPOSE_AND_ASK_THE_NEXT_DISCOVERY_QUESTION",
      conversationalType: "DISCOVERY",
      proposedStateOperations: [{ operation: "SET", field: "purpose", value: "LIVING" }],
      recentContextUsed: true,
    }),
    reply: "تمام، للسكن. أنسب منطقة ليك تبقى فين؟",
  });
  assert.equal(purpose.next.search.purpose, "LIVING");
  assert.deepEqual(purpose.plan.steps, []);
  assert.equal(purpose.next.lastOperations.length, 1);
});

test("customer background is not a constraint until a contextual preference is expressed", async () => {
  const previous = state({ search: { locations: [], projects: [], developers: [], propertyTypes: [], purpose: "LIVING" } });
  const context: NadimConversationContext = {
    stage: "DISCOVERY",
    recentTurns: [{ user: "للسكن", assistant: "أنسب مكان ليك يبقى فين؟", intent: "CONVERSATION", tools: [] }],
  };
  const background = await runConversation({
    message: "أنا شغلي في التجمع",
    previous,
    context,
    interpretation: semantic({
      understoodMeaning: "The customer shares that their workplace is in New Cairo as background context.",
      responseGoal: "ACKNOWLEDGE_THE_COMMUTE_CONTEXT_WITHOUT_CHANGING_SEARCH",
      conversationalType: "CONVERSATION",
      recentContextUsed: true,
    }),
    reply: "تمام، كده القرب من الشغل ممكن يبقى عامل مهم.",
  });
  assert.deepEqual(background.next.search.locations, []);
  assert.deepEqual(background.next.lastOperations, []);
  assert.deepEqual(background.plan.steps, []);

  const preferenceContext: NadimConversationContext = {
    stage: "DISCOVERY",
    recentTurns: [...context.recentTurns, { user: "أنا شغلي في التجمع", assistant: background.composed.reply, intent: "CONVERSATION", tools: [] }],
  };
  const preference = await runConversation({
    message: "الأحسن يبقى حواليه",
    previous: background.next,
    context: preferenceContext,
    interpretation: semantic({
      understoodMeaning: "The customer prefers the home near the workplace just mentioned in New Cairo.",
      responseGoal: "CONFIRM_THE_CONTEXTUAL_LOCATION_PREFERENCE_AND_CONTINUE_DISCOVERY",
      conversationalType: "DISCOVERY",
      proposedStateOperations: [{ operation: "SET", field: "locations", value: ["التجمع"] }],
      references: [{ expression: "حواليه", resolvedAs: "RECENT_DIALOGUE", confidence: 0.91 }],
      recentContextUsed: true,
    }),
    reply: "تمام، نخلي القرب من التجمع ضمن اللي بندور عليه.",
  });
  assert.deepEqual(preference.next.search.locations, ["التجمع"]);
  assert.deepEqual(preference.plan.steps, []);
  assert.equal(preference.understood.understanding.recentContextUsed, true);
});

test("reactions, acknowledgements, and advisory tool hints cannot mutate or execute by themselves", async () => {
  const previous = state({
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], budgetMax: 8_000_000 },
    lastResultIds: ["unit-1", "unit-2"],
  });
  for (const item of [
    { message: "حلو", type: "ACKNOWLEDGEMENT" as const, goal: "ACKNOWLEDGE", reply: "تمام." },
    { message: "غالي", type: "REACTION" as const, goal: "ACKNOWLEDGE_PRICE_REACTION_WITHOUT_ASSUMING_A_NEW_BUDGET", reply: "فاهمك، السعر مش مريحك." },
    { message: "طب غيره", type: "REACTION" as const, goal: "ASK_WHAT_SHOULD_DIFFER_BEFORE_CHANGING_THE_SEARCH", reply: "أكيد، تحب البديل يختلف في إيه؟" },
  ]) {
    const result = await runConversation({
      message: item.message,
      previous,
      interpretation: semantic({
        understoodMeaning: "A reaction to the current options, without an explicit state change.",
        responseGoal: item.goal,
        conversationalType: item.type,
        proposedStateOperations: [{ operation: "SET", field: "budgetMax", value: 20_000_000 }],
        toolNeed: { required: true, kind: "PROPERTY_SEARCH", reason: "Advisory model hint only" },
      }),
      reply: item.reply,
    });
    assert.deepEqual(result.next.search, previous.search, item.message);
    assert.equal(result.next.selectedUnitId, undefined, item.message);
    assert.deepEqual(result.plan.steps, [], item.message);
  }
});

test("only a structured semantic request can cross the deterministic property-search gate", async () => {
  const previous = state();
  const premature = await runConversation({
    message: "نفسي أشتري",
    previous,
    interpretation: semantic({
      understoodMeaning: "The customer broadly wants to buy a property but has supplied no usable search constraints.",
      responseGoal: "ASK_ONE_USEFUL_DISCOVERY_QUESTION",
      conversationalType: "STRUCTURED_REQUEST",
      proposedIntent: "PROPERTY_SEARCH",
      toolNeed: { required: true, kind: "PROPERTY_SEARCH" },
    }),
    reply: "تمام، نبدأ بالمنطقة ولا الميزانية؟",
  });
  assert.equal(premature.understood.understanding.intent, "CONVERSATION");
  assert.deepEqual(premature.plan.steps, []);

  const conversational = await runConversation({
    message: "خلينا نفكر سوا الأول",
    previous,
    interpretation: semantic({
      understoodMeaning: "The customer wants to reason about needs before searching.",
      responseGoal: "CONTINUE_DISCOVERY_WITHOUT_INVENTORY",
      conversationalType: "DISCOVERY",
      toolNeed: { required: true, kind: "PROPERTY_SEARCH" },
    }),
    reply: "أكيد، نرتب احتياجاتك الأول.",
  });
  assert.deepEqual(conversational.plan.steps, []);

  const structured = await runConversation({
    message: "اعرض شقق غرفتين في زايد",
    previous,
    interpretation: semantic({
      understoodMeaning: "Search verified inventory for two-bedroom apartments in Sheikh Zayed.",
      responseGoal: "SEARCH_VERIFIED_INVENTORY",
      conversationalType: "STRUCTURED_REQUEST",
      proposedIntent: "PROPERTY_SEARCH",
      proposedStateOperations: [
        { operation: "SET", field: "propertyTypes", value: ["Apartment"] },
        { operation: "SET", field: "bedrooms", value: 2 },
        { operation: "SET", field: "locations", value: ["الشيخ زايد"] },
      ],
      toolNeed: { required: true, kind: "PROPERTY_SEARCH" },
    }),
  });
  assert.equal(structured.understood.understanding.intent, "PROPERTY_SEARCH");
  assert.equal(structured.plan.steps[0]?.tool, "PROPERTY_SEARCH");
});

test("UNKNOWN remains rare and reserved for corruption or a model-declared lack of meaning", async () => {
  for (const message of ["asdjkhqweq", "%%^^"]) {
    const hostile = dialogue(semantic({ proposedIntent: "PROPERTY_SEARCH", conversationalType: "STRUCTURED_REQUEST" }));
    const understood = await new UnderstandingService(hostile as any).understand(message, state());
    const next = stateEngine.apply(state(), understood.understanding, { channel: "WEB" });
    assert.equal(hostile.calls.understand, 0, message);
    assert.equal(understood.understanding.intent, "UNKNOWN", message);
    assert.equal(understood.understanding.classificationSource, "DETERMINISTIC_GIBBERISH", message);
    assert.deepEqual(planner.plan(understood.understanding, next).steps, [], message);
  }

  const unclear = await runConversation({
    message: "فرطشق",
    interpretation: semantic({
      understood: false,
      understoodMeaning: "No reliable conversational meaning can be recovered.",
      responseGoal: "ASK_FOR_CLARIFICATION",
      conversationalType: "CLARIFICATION",
      clarification: { required: true, reason: "NO_RECOVERABLE_MEANING" },
      confidence: 0.94,
    }),
  });
  assert.equal(unclear.understood.understanding.intent, "UNKNOWN");
  assert.equal(unclear.understood.understanding.unknownReason, "NO_RECOVERABLE_MEANING");
  assert.deepEqual(unclear.plan.steps, []);
  assert.deepEqual(unclear.next.search, unclear.previous.search);
});

test("natural multi-word conversation degrades safely when semantic providers are unavailable", async () => {
  const unavailable: any = { available: () => false };
  const understood = await new UnderstandingService(unavailable).understand("صباح مليان خير", state());
  const plan = planner.plan(understood.understanding, state());
  assert.equal(understood.understanding.intent, "CONVERSATION");
  assert.equal(understood.understanding.classificationSource, "DETERMINISTIC_SAFE_FALLBACK");
  assert.equal(understood.understanding.unknownReason, "SEMANTIC_MODEL_UNAVAILABLE");
  assert.deepEqual(plan.steps, []);

  const metaphor = await new UnderstandingService(unavailable).understand("نفسي أملك بس لسه الصورة مش واضحة", state());
  assert.equal(metaphor.understanding.intent, "CONVERSATION");
  assert.notEqual(metaphor.understanding.intent, "MEDIA_REQUEST");
  assert.deepEqual(planner.plan(metaphor.understanding, state()).steps, []);
});

test("turn observability separates understanding diagnostics from composition and redacts meaning", async () => {
  const previousEnabled = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  let persisted: any;
  let toolExecutorCalls = 0;
  const model = dialogue(semantic({
    understoodMeaning: "The customer test@example.com at +20 100 123 4567 is acknowledging the explanation.",
    responseGoal: "ACKNOWLEDGE_BRIEFLY",
    conversationalType: "ACKNOWLEDGEMENT",
  }), "تمام، إحنا متفقين.");
  const conversations: any = {
    resolve: async () => ({
      conversation: { id: "conversation-semantic-observability" },
      state: state(),
      customerId: undefined,
      conversationContext: { stage: "DISCOVERY", recentTurns: [] },
    }),
    persist: async (value: any) => { persisted = value; },
  };
  const service = new NadimV2Service(
    conversations,
    new UnderstandingService(model as any),
    stateEngine,
    planner,
    { execute: async (turnPlan: { steps: unknown[] }) => { toolExecutorCalls += 1; assert.deepEqual(turnPlan.steps, []); return []; } } as any,
    { propose: () => [], execute: async () => [] } as any,
    new ResponseComposerService(model as any),
    detector,
  );
  try {
    const result = await service.turn({ channel: "WEB", message: "واضحة كده" }, "semantic-observability-request");
    assert.equal(result.intent.type, "CONVERSATION");
    assert.equal(result.metadata.classificationSource, "MODEL_SEMANTIC");
    assert.equal(result.metadata.understandingModelProvider, "groq");
    assert.equal(result.metadata.understandingModel, "semantic-fixture");
    assert.equal(result.metadata.understandingFallbackUsed, false);
    assert.equal(result.metadata.responseGoal, "ACKNOWLEDGE_BRIEFLY");
    assert.equal(result.metadata.recentContextUsed, false);
    assert.equal(result.metadata.toolDecision, "NO_TOOL");
    assert.deepEqual(result.metadata.toolNames, []);
    assert.match(result.metadata.understoodMeaning ?? "", /\[email\]|\[phone\]/u);
    assert.doesNotMatch(result.metadata.understoodMeaning ?? "", /test@example\.com|100 123 4567/u);
    assert.equal(toolExecutorCalls, 1);
    assert.equal(persisted.response.metadata.classificationSource, "MODEL_SEMANTIC");
  } finally {
    if (previousEnabled === undefined) delete process.env.NADIM_V2_ENABLED;
    else process.env.NADIM_V2_ENABLED = previousEnabled;
  }
});
