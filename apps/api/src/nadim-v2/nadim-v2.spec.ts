import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ConflictException } from "@nestjs/common";
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AutomationActionClient } from "./actions/automation-action.client";
import { ActionPolicyService } from "./brain/action-policy.service";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { ToolExecutorService } from "./brain/tool-executor.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimUnderstanding } from "./domain/nadim-intent";
import { conversationStage, NadimConversationContext, NadimRecentTurnContext } from "./domain/nadim-conversation-context";
import { initialNadimState, NadimState } from "./domain/nadim-state";
import { buildNadimUi } from "./domain/nadim-ui";
import { NadimV2Controller } from "./nadim-v2.controller";
import { NadimV2Service } from "./nadim-v2.service";
import { NadimConversationService } from "./persistence/nadim-conversation.service";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { BedrockGlmProvider } from "./providers/bedrock-glm.provider";
import { DialogueModelService } from "./providers/dialogue-model.service";
import { DialogueProviderError, DialogueStreamInterruptedError } from "./providers/dialogue-provider";
import { NadimGatewayGuard } from "./security/nadim-gateway.guard";

const stateEngine = new StateEngineService();
const noModel: any = { available: () => false };
const understandingService = new UnderstandingService(noModel);
const planner = new PlannerService();
const composer = new ResponseComposerService(noModel);
const languageStyles = new LanguageStyleDetectorService();

function state(overrides: Partial<NadimState> = {}) {
  return { ...initialNadimState({ channel: "WEB", locale: "ar-EG" }), ...overrides };
}

async function understand(message: string, previous = state()) {
  return (await understandingService.understand(message, previous)).understanding;
}

function actionPolicy(result: any = { status: "NOT_EXECUTED", errorCode: "ACTION_EXECUTION_DISABLED" }) {
  return new ActionPolicyService({ execute: async (action: any) => ({ type: action.type, ...result }) } as AutomationActionClient);
}

test("1 greeting is understood without invoking legacy chat", async () => {
  assert.equal((await understand("أهلا يا نديم")).intent, "GREETING");
});

test("2 simple property search creates an explicit search plan", async () => {
  const intent = await understand("عايز شقة");
  const next = stateEngine.apply(state(), intent, { channel: "WEB" });
  assert.equal(planner.plan(intent, next).steps[0].tool, "PROPERTY_SEARCH");
});

test("3 Egyptian Arabic extracts location budget and bedrooms", async () => {
  const intent = await understand("عايز شقة في التجمع 3 غرف تحت 8 مليون");
  const next = stateEngine.apply(state(), intent, { channel: "WEB" });
  assert.deepEqual(next.search.locations, ["التجمع"]);
  assert.equal(next.search.bedrooms, 3);
  assert.equal(next.search.budgetMax, 8_000_000);
});

test("4 English query is parsed into the same state contract", async () => {
  const intent = await understand("Looking for a 2 bedroom apartment in New Cairo under 6 million");
  const next = stateEngine.apply(state(), intent, { channel: "WEB" });
  assert.equal(intent.intent, "PROPERTY_SEARCH");
  assert.deepEqual(next.search.locations, ["new cairo"]);
  assert.equal(next.search.budgetMax, 6_000_000);
});

test("5 combined location budget and bedrooms remain independent", async () => {
  const next = stateEngine.apply(state(), await understand("بدور على شقة في زايد 4 غرف تحت 12 مليون"), { channel: "WEB" });
  assert.deepEqual({ locations: next.search.locations, bedrooms: next.search.bedrooms, budgetMax: next.search.budgetMax }, { locations: ["زايد"], bedrooms: 4, budgetMax: 12_000_000 });
});

test("compound Arabic search dominates installment wording and executes property search", async () => {
  const intent = await understand("عايز شقة 3 غرف في التجمع بحد أقصى 8 مليون وتقسيط طويل");
  const current = stateEngine.apply(state(), intent, { channel: "WEB" });
  const plan = planner.plan(intent, current);
  let searches = 0;
  let trustedIntent: any;
  const executor = new ToolExecutorService({
    searchProperties: async (input: any) => { searches += 1; trustedIntent = input; return []; },
  } as any, {} as any);
  const results = await executor.execute(plan, current);
  assert.equal(intent.intent, "PROPERTY_SEARCH");
  assert.equal(plan.steps[0].tool, "PROPERTY_SEARCH");
  assert.equal(searches, 1);
  assert.equal(results[0].tool, "PROPERTY_SEARCH");
  assert.equal(current.search.budgetMax, 8_000_000);
  assert.equal(current.search.installmentPreference, "LONG_TERM");
  assert.equal(current.search.installmentMonths, undefined);
  assert.deepEqual(trustedIntent.softPreferences, ["LONG_TERM_INSTALLMENTS"]);
});

test("installment preference remains a new property search when requesting a property", async () => {
  for (const message of ["عايز شقة بالتقسيط في زايد", "عايز شقة وتقسيط طويل"]) {
    const intent = await understand(message);
    const current = stateEngine.apply(state(), intent, { channel: "WEB" });
    assert.equal(intent.intent, "PROPERTY_SEARCH", message);
    assert.equal(planner.plan(intent, current).steps[0].tool, "PROPERTY_SEARCH", message);
  }
});

test("payment-plan questions remain questions about a selected unit", async () => {
  assert.equal((await understand("نظام التقسيط بتاع الوحدة دي إيه؟")).intent, "PAYMENT_PLAN_QUESTION");
  const selected = state({ selectedUnitId: "unit-1" });
  const intent = await understand("المقدم كام والتقسيط على كام سنة؟", selected);
  assert.equal(intent.intent, "PAYMENT_PLAN_QUESTION");
  assert.equal(planner.plan(intent, selected).steps[0].tool, "GET_PAYMENT_PLAN");
});

test("only active search state turns installment changes into MODIFY_SEARCH", async () => {
  const freshIntent = await understand("عايز شقة وتقسيط طويل");
  assert.equal(freshIntent.intent, "PROPERTY_SEARCH");
  const previous = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"] } });
  const modification = await understand("خليها بالتقسيط على مدة أطول", previous);
  const current = stateEngine.apply(previous, modification, { channel: "WEB" });
  assert.equal(modification.intent, "MODIFY_SEARCH");
  assert.equal(current.search.installmentPreference, "LONG_TERM");
  assert.deepEqual(current.search.locations, ["التجمع"]);
  assert.equal(planner.plan(modification, current).steps[0].tool, "PROPERTY_SEARCH");
});

test("6 budget modification preserves location and bedrooms", async () => {
  const firstIntent = await understand("عايز شقة في التجمع 3 غرف تحت 8 مليون");
  const first = stateEngine.apply(state(), firstIntent, { channel: "WEB" });
  const second = stateEngine.apply(first, await understand("نفس المواصفات بس خلي الميزانية 10", first), { channel: "WEB" });
  assert.deepEqual(second.search.locations, ["التجمع"]);
  assert.equal(second.search.bedrooms, 3);
  assert.equal(second.search.budgetMax, 10_000_000);
});

test("criteria changes invalidate stale result, selection, and comparison context", async () => {
  const previous = state({
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000 },
    lastResultIds: ["old-1", "old-2"], selectedUnitId: "old-2", selectedProjectId: "project-old", comparisonUnitIds: ["old-1", "old-2"],
  });
  const intent = await understand("خلي الميزانية 12 مليون", previous);
  const next = stateEngine.apply(previous, intent, { channel: "WEB" });
  assert.equal(next.search.budgetMax, 12_000_000);
  assert.deepEqual(next.lastResultIds, []);
  assert.deepEqual(next.comparisonUnitIds, []);
  assert.equal(next.selectedUnitId, undefined);
  assert.equal(next.selectedProjectId, undefined);
  assert.equal(planner.plan(intent, next).steps[0]?.tool, "PROPERTY_SEARCH");
});

test("7 removing location changes only that constraint", async () => {
  const previous = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000 } });
  const next = stateEngine.apply(previous, await understand("مش مهم التجمع", previous), { channel: "WEB" });
  assert.deepEqual(next.search.locations, []);
  assert.equal(next.search.bedrooms, 3);
  assert.equal(next.search.budgetMax, 10_000_000);
});

test("contextual Egyptian budget updates preserve the active search and rerun it", async () => {
  const firstIntent = await understand("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  const first = stateEngine.apply(state(), firstIntent, { channel: "WEB" });
  const secondIntent = await understand("خليها 10 مليون", first);
  const second = stateEngine.apply(first, secondIntent, { channel: "WEB" });
  const plan = planner.plan(secondIntent, second);

  assert.equal(secondIntent.intent, "MODIFY_SEARCH");
  assert.deepEqual(secondIntent.operations.filter((item) => item.operation === "SET"), [
    { operation: "SET", field: "budgetMax", value: 10_000_000 },
  ]);
  assert.equal(second.search.budgetMax, 10_000_000);
  assert.equal(second.search.bedrooms, 3);
  assert.deepEqual(second.search.locations, ["التجمع"]);
  assert.deepEqual(second.search.propertyTypes, ["Apartment"]);
  assert.equal(plan.steps[0]?.tool, "PROPERTY_SEARCH");
});

test("current-state questions answer persisted search state without tools or mutation", async () => {
  const active = state({
    revision: 2,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000, currency: "EGP" },
  });
  const intent = await understand("الميزانية اللي محددها كام؟", active);
  const next = stateEngine.apply(active, intent, { channel: "WEB" });
  const plan = planner.plan(intent, next);
  const response = await composer.compose({ userMessage: "الميزانية اللي محددها كام؟", understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });

  assert.equal(intent.intent, "CURRENT_SEARCH_QUERY");
  assert.equal(intent.stateQuery, "budgetMax");
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(next.search, active.search);
  assert.match(response.reply, /10,000,000|10\s*مليون/iu);
  assert.doesNotMatch(response.reply, /(?:مش ظاهر|مفيش اختيار|no suitable)/iu);
});

test("current-state queries resolve bedrooms, location, summary, and unset values deterministically", async () => {
  const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000 } });
  for (const [message, target] of [
    ["كنت طالب كام غرفة؟", "bedrooms"],
    ["إحنا بندور فين؟", "locations"],
    ["المواصفات اللي قولتهالك إيه؟", "SEARCH"],
  ] as const) {
    const intent = await understand(message, active);
    const plan = planner.plan(intent, stateEngine.apply(active, intent, { channel: "WEB" }));
    assert.equal(intent.intent, "CURRENT_SEARCH_QUERY", message);
    assert.equal(intent.stateQuery, target, message);
    assert.deepEqual(plan.steps, [], message);
  }

  const noBudget = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: [] } });
  const intent = await understand("أنا محدد ميزانية قد إيه؟", noBudget);
  const next = stateEngine.apply(noBudget, intent, { channel: "WEB" });
  const response = await composer.compose({ userMessage: "أنا محدد ميزانية قد إيه؟", understanding: intent, state: next, plan: planner.plan(intent, next), toolResults: [], proposedActions: [], executedActions: [] });
  assert.doesNotMatch(response.reply, /(?:\d[\d,.]*\s*(?:EGP|مليون)|مش ظاهر|no suitable)/iu);
});

test("noisy budget questions use semantic understanding with active state and never search", async () => {
  let modelCalls = 0;
  let suppliedBudget: number | undefined;
  const model: any = {
    available: () => true,
    understand: async (_message: string, current: NadimState) => {
      modelCalls += 1;
      suppliedBudget = current.search.budgetMax;
      return {
        value: {
          understood: true,
          understoodMeaning: "The customer is asking for the currently stored maximum budget.",
          responseGoal: "ANSWER_CURRENT_BUDGET",
          conversationalType: "STRUCTURED_REQUEST",
          proposedIntent: "CURRENT_SEARCH_QUERY",
          proposedStateOperations: [{ operation: "SET", field: "budgetMax", value: 99_000_000 }],
          references: [], toolNeed: { required: false }, clarification: { required: false },
          confidence: 0.93, stateQuery: "budgetMax", ordinalReferences: [], recentContextUsed: true,
        },
        provider: "test", model: "semantic-test", fallbackUsed: false, latencyMs: 1,
      };
    },
  };
  const active = state({ search: { locations: [], projects: [], developers: [], propertyTypes: [], budgetMax: 10_000_000 } });
  const intent = (await new UnderstandingService(model).understand("ميزانيه ال محددهل انا كام", active)).understanding;
  assert.equal(modelCalls, 1);
  assert.equal(suppliedBudget, 10_000_000);
  assert.equal(intent.intent, "CURRENT_SEARCH_QUERY");
  assert.equal(intent.stateQuery, "budgetMax");
  assert.deepEqual(intent.operations, []);
  const next = stateEngine.apply(active, intent, { channel: "WEB" });
  assert.equal(next.search.budgetMax, 10_000_000);
  assert.deepEqual(planner.plan(intent, next).steps, []);
});

test("rejecting proposed widening preserves constraints and acknowledges without searching", async () => {
  const active = state({
    revision: 3,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
    recentAssistantWording: "مش ظاهر معايا حاجة مناسبة بالمواصفات دي دلوقتي.",
  });
  const intent = await understand("لا توسع الخيارات", active);
  const next = stateEngine.apply(active, intent, { channel: "WEB" });
  const plan = planner.plan(intent, next);
  const response = await composer.compose({ userMessage: "لا توسع الخيارات", understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });

  assert.equal(intent.intent, "CORRECTION");
  assert.deepEqual(intent.operations, [{ operation: "PRESERVE", field: "SEARCH" }]);
  assert.deepEqual(next.search, active.search);
  assert.deepEqual(plan.steps, []);
  assert.doesNotMatch(response.reply, /(?:مش فاهم|ما فهمت|no suitable|مش ظاهر)/iu);
});

test("contextual remove and preserve-plus-change operations affect only requested fields", async () => {
  const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 } });
  const removedIntent = await understand("سيب المكان مفتوح", active);
  const removed = stateEngine.apply(active, removedIntent, { channel: "WEB" });
  assert.deepEqual(removedIntent.operations, [{ operation: "REMOVE", field: "locations" }]);
  assert.deepEqual(removed.search.locations, []);
  assert.equal(removed.search.bedrooms, 3);

  const changedIntent = await understand("نفس المواصفات بس 10 مليون", active);
  const changed = stateEngine.apply(active, changedIntent, { channel: "WEB" });
  assert.equal(changedIntent.intent, "MODIFY_SEARCH");
  assert.equal(changed.search.budgetMax, 10_000_000);
  assert.equal(changed.search.bedrooms, 3);
  assert.deepEqual(changed.search.locations, ["التجمع"]);
  assert.deepEqual(changed.search.propertyTypes, ["Apartment"]);
});

test("dominant numeric and bedroom references resolve from active search while vague changes clarify", async () => {
  const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 } });
  const budgetIntent = await understand("خليها 12", active);
  const budgetState = stateEngine.apply(active, budgetIntent, { channel: "WEB" });
  assert.equal(budgetIntent.intent, "MODIFY_SEARCH");
  assert.equal(budgetState.search.budgetMax, 12_000_000);
  assert.equal(budgetState.search.bedrooms, 3);

  const bedroomIntent = await understand("خليهم 4 غرف", active);
  const bedroomState = stateEngine.apply(active, bedroomIntent, { channel: "WEB" });
  assert.equal(bedroomIntent.intent, "MODIFY_SEARCH");
  assert.equal(bedroomState.search.bedrooms, 4);
  assert.equal(bedroomState.search.budgetMax, 8_000_000);

  const vagueIntent = await understand("زودها شوية", active);
  const vaguePlan = planner.plan(vagueIntent, stateEngine.apply(active, vagueIntent, { channel: "WEB" }));
  assert.equal(vagueIntent.intent, "MODIFY_SEARCH");
  assert.equal(vagueIntent.ambiguity, "SEARCH_CHANGE_AMOUNT_REQUIRED");
  assert.deepEqual(vaguePlan.steps, []);
  assert.equal(vaguePlan.clarification, "SEARCH_CHANGE_AMOUNT_REQUIRED");

  const preserveIntent = await understand("خليك على نفس المواصفات", active);
  assert.equal(preserveIntent.intent, "CORRECTION");
  assert.deepEqual(planner.plan(preserveIntent, stateEngine.apply(active, preserveIntent, { channel: "WEB" })).steps, []);
});

test("Gulf greeting is a greeting and cannot become an address-change acknowledgement", async () => {
  const gulfState = initialNadimState({ channel: "WEB", locale: "ar-SA" });
  const styled = languageStyles.apply(gulfState, "هلا");
  const intent = await understand("هلا", styled);
  const next = stateEngine.apply(styled, intent, { channel: "WEB" });
  const plan = planner.plan(intent, next);
  const response = await composer.compose({ userMessage: "هلا", understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });

  assert.equal(styled.languageStyle.preferredResponseStyle, "AR_GULF");
  assert.equal(styled.languageStyle.grammaticalAddressChangedThisTurn, false);
  assert.equal(intent.intent, "GREETING");
  assert.deepEqual(plan.steps, []);
  assert.match(response.reply, /نديم/u);
  assert.doesNotMatch(response.reply, /(?:بالطريقة هذي|بكمل بالطريقة)/u);

  const active = languageStyles.apply({ ...gulfState, revision: 4, search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], budgetMax: 8_000_000 } }, "هلا");
  const activeIntent = await understand("هلا", active);
  const activeNext = stateEngine.apply(active, activeIntent, { channel: "WEB" });
  const activeResponse = await composer.compose({ userMessage: "هلا", understanding: activeIntent, state: activeNext, plan: planner.plan(activeIntent, activeNext), toolResults: [], proposedActions: [], executedActions: [] });
  assert.deepEqual(activeNext.search, active.search);
  assert.doesNotMatch(activeResponse.reply, /(?:بدأنا|بحث جديد|بالطريقة هذي)/u);
});

test("gibberish and ambiguous Arabic noise preserve state without search or no-match claims", async () => {
  const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], budgetMax: 8_000_000 } });
  for (const message of ["svgsvg", "عالا"]) {
    const intent = await understand(message, active);
    const next = stateEngine.apply(active, intent, { channel: "WEB" });
    const plan = planner.plan(intent, next);
    const response = await composer.compose({ userMessage: message, understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });
    assert.equal(intent.intent, "UNKNOWN", message);
    assert.deepEqual(intent.operations, [], message);
    assert.deepEqual(next.search, active.search, message);
    assert.deepEqual(plan.steps, [], message);
    assert.doesNotMatch(response.reply, /(?:مش ظاهر|مفيش اختيار|no suitable)/iu, message);
  }
});

test("multilingual contextual updates preserve the established response style", async () => {
  const cases = [
    ["خلها 10 مليون", "AR_GULF"],
    ["Make it 10 million", "EN_US"],
    ["khalyha 10 million", "FRANCO_ARABIC"],
    ["خلي الـbudget 10 million", "MIXED_AR_EN"],
  ] as const;
  for (const [message, expectedStyle] of cases) {
    const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 } });
    const styled = languageStyles.apply(active, message);
    const intent = await understand(message, styled);
    const next = stateEngine.apply(styled, intent, { channel: "WEB" });
    assert.equal(styled.languageStyle.inputLanguage, expectedStyle, message);
    assert.equal(styled.languageStyle.preferredResponseStyle, "AR_EGYPTIAN", message);
    assert.equal(intent.intent, "MODIFY_SEARCH", message);
    assert.equal(next.search.budgetMax, 10_000_000, message);
    assert.equal(next.search.bedrooms, 3, message);
    assert.equal(planner.plan(intent, next).steps[0]?.tool, "PROPERTY_SEARCH", message);
  }
});

test("language-only requests cannot hallucinate search operations", async () => {
  const active = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 } });
  const styled = languageStyles.apply(active, "Explain it in English");
  const intent = await understand("Explain it in English", styled);
  const next = stateEngine.apply(styled, intent, { channel: "WEB" });
  const plan = planner.plan(intent, next);
  const response = await composer.compose({ userMessage: "Explain it in English", understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });
  assert.equal(intent.intent, "LANGUAGE_STYLE_CHANGE");
  assert.deepEqual(next.lastOperations, []);
  assert.deepEqual(next.search, active.search);
  assert.deepEqual(plan.steps, []);
  assert.doesNotMatch(response.reply, /(?:budget|location).*(?:updated|changed)|(?:الميزانية|المكان).*(?:اتغير|غيّرت)/iu);
});

test("8 reset search clears constraints and result references", async () => {
  const previous = state({ search: { locations: ["زايد"], projects: [], developers: [], propertyTypes: [], budgetMax: 9_000_000 }, lastResultIds: ["u1"] });
  const intent = await understand("ابدأ بحث جديد", previous);
  const next = stateEngine.apply(previous, intent, { channel: "WEB" });
  assert.deepEqual(next.search.locations, []);
  assert.equal(next.search.budgetMax, undefined);
  assert.deepEqual(next.lastResultIds, []);
  assert.deepEqual(planner.plan(intent, next).steps, []);
});

test("9 verified no-match is stated honestly without robotic or causal claims", async () => {
  const intent = await understand("عايز شقة تحت 5 مليون");
  const current = stateEngine.apply(state(), intent, { channel: "WEB" });
  const plan = planner.plan(intent, current);
  const reply = await composer.compose({ userMessage: "x", understanding: intent, state: current, plan, toolResults: [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }], proposedActions: [], executedActions: [] });
  assert.match(reply.reply, /(?:مش شايف|مش ظاهر|مفيش حاجة)/u);
  assert.doesNotMatch(reply.reply, /(?:مطابقة 100%|القيد|الميزانية.{0,20}(?:السبب|مقلل|مانع))/u);
});

test("10 no-match does not mutate or widen constraints", async () => {
  const current = state({ search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: [], bedrooms: 3, budgetMax: 5_000_000 } });
  const reply = await composer.compose({ userMessage: "x", understanding: { intent: "PROPERTY_SEARCH", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false }, state: current, plan: { goal: "PROPERTY_SEARCH", steps: [] }, toolResults: [], proposedActions: [], executedActions: [] });
  assert.equal(current.search.budgetMax, 5_000_000);
  assert.deepEqual(current.search.locations, ["التجمع"]);
  assert.doesNotMatch(reply.reply, /(?:ملقتش|مفيش\s+(?:نتائج|وحدات)|no results|nothing matched)/iu);
});

test("model composition cannot claim zero inventory when PROPERTY_SEARCH did not run", async () => {
  const unsafeModel: any = {
    available: () => true,
    compose: async () => ({ value: "مفيش وحدات متاحة", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }),
  };
  const guardedComposer = new ResponseComposerService(unsafeModel);
  const reply = await guardedComposer.compose({
    userMessage: "ساعدني",
    understanding: { intent: "SMALL_TALK", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false },
    state: state(),
    plan: { goal: "SMALL_TALK", steps: [] },
    toolResults: [],
    proposedActions: [],
    executedActions: [],
  });
  assert.doesNotMatch(reply.reply, /(?:ملقتش|مفيش\s+(?:نتائج|وحدات)|no results|nothing matched)/iu);
});

test("11 ordinal reference resolves the second persisted result", async () => {
  const previous = state({ lastResultIds: ["u1", "u2", "u3"] });
  const next = stateEngine.apply(previous, await understand("التانية", previous), { channel: "WEB" });
  assert.equal(next.selectedUnitId, "u2");
});

test("12 comparison resolves first and third from persisted IDs", async () => {
  const previous = state({ lastResultIds: ["u1", "u2", "u3"] });
  const intent = await understand("قارن الأول والتالت", previous);
  const next = stateEngine.apply(previous, intent, { channel: "WEB" });
  assert.deepEqual(next.comparisonUnitIds, ["u1", "u3"]);
  assert.equal(planner.plan(intent, next).steps[0].tool, "COMPARE_PROPERTIES");
});

test("13 media request uses the selected ordinal result", async () => {
  const previous = state({ lastResultIds: ["u1", "u2"] });
  const intent = await understand("وريني صور التانية", previous);
  const next = stateEngine.apply(previous, intent, { channel: "WEB" });
  assert.equal(planner.plan(intent, next).steps[0].tool, "GET_MEDIA");
  assert.equal(next.selectedUnitId, "u2");
});

test("14 verified price reply uses only tool data", async () => {
  const intent: NadimUnderstanding = { intent: "PRICE_QUESTION", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
  const reply = await composer.compose({ userMessage: "price", understanding: intent, state: state({ selectedUnitId: "u1" }), plan: planner.plan(intent, state({ selectedUnitId: "u1" })), toolResults: [{ tool: "GET_UNIT_FACTS", ok: true, data: { id: "u1", externalUnitId: "A-1", price: 7_000_000, currency: "EGP" }, latencyMs: 1 }], proposedActions: [], executedActions: [] });
  assert.match(reply.reply, /7\s*مليون\s*جنيه/u);
  assert.doesNotMatch(reply.reply, /7,000,000 EGP/u);
});

test("15 payment-plan question is backed by the payment tool", async () => {
  const intent: NadimUnderstanding = { intent: "PAYMENT_PLAN_QUESTION", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
  const selected = state({ selectedUnitId: "u1" });
  assert.equal(planner.plan(intent, selected).steps[0].tool, "GET_PAYMENT_PLAN");
});

test("16 availability question is backed by availability tool", async () => {
  const intent: NadimUnderstanding = { intent: "AVAILABILITY_QUESTION", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
  assert.equal(planner.plan(intent, state({ selectedUnitId: "u1" })).steps[0].tool, "GET_AVAILABILITY");
});

test("17 unknown fact does not hallucinate", async () => {
  const intent: NadimUnderstanding = { intent: "PRICE_QUESTION", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
  const reply = await composer.compose({ userMessage: "price", understanding: intent, state: state({ selectedUnitId: "u1" }), plan: { goal: "PRICE_QUESTION", steps: [{ tool: "GET_UNIT_FACTS", arguments: { unitId: "u1" } }] }, toolResults: [{ tool: "GET_UNIT_FACTS", ok: false, errorCode: "VERIFIED_DATA_NOT_FOUND", latencyMs: 1 }], proposedActions: [], executedActions: [] });
  assert.match(reply.reply, /مش موثقة/u);
  assert.doesNotMatch(reply.reply, /مليون/u);
});

test("Arabic price and installment questions without verified facts invent no figures and offer a next step", async () => {
  const selected = state({ selectedUnitId: "u-missing" });
  for (const [message, intentType, tool] of [
    ["كام سعرها؟", "PRICE_QUESTION", "GET_UNIT_FACTS"],
    ["فيه نظام أقساط؟", "PAYMENT_PLAN_QUESTION", "GET_PAYMENT_PLAN"],
  ] as const) {
    const intent: NadimUnderstanding = { intent: intentType, confidence: 1, operations: [], ordinalReferences: [], actionRequested: false };
    const reply = await composer.compose({ userMessage: message, understanding: intent, state: selected, plan: planner.plan(intent, selected), toolResults: [{ tool, ok: false, errorCode: "VERIFIED_DATA_NOT_FOUND", latencyMs: 1 }], proposedActions: [], executedActions: [] });
    assert.doesNotMatch(reply.reply, /\b\d+(?:[.,]\d+)?\s*(?:مليون|جنيه|%|شهر|سنة)/u);
    assert.match(reply.reply, /(?:أتابع|الفريق|المبيعات|مش موثق|مش موثقة|معنديش)/u);
  }
});

test("18 explicit contact request proposes a lead action", async () => {
  const intent = await understand("أنا مهتم سيب بياناتي");
  assert.equal(actionPolicy().propose(intent, state())[0].type, "CREATE_LEAD");
});

test("19 viewing request proposes a viewing action", async () => {
  const intent = await understand("عايز معاينة");
  assert.equal(actionPolicy().propose(intent, state({ selectedUnitId: "u1" }))[0].type, "CREATE_VIEWING_REQUEST");
});

test("20 reservation request proposes a reservation action", async () => {
  const intent = await understand("احجز دي");
  assert.equal(actionPolicy().propose(intent, state({ selectedUnitId: "u1" }))[0].type, "CREATE_RESERVATION_REQUEST");
});

test("21 action failure never produces a success claim", async () => {
  const intent = await understand("عايز معاينة");
  const reply = await composer.compose({ userMessage: "x", understanding: intent, state: state({ selectedUnitId: "u1" }), plan: { goal: "VIEWING_REQUEST", steps: [] }, toolResults: [], proposedActions: [], executedActions: [{ type: "CREATE_VIEWING_REQUEST", status: "FAILED", errorCode: "ACTION_LAYER_UNAVAILABLE" }] });
  assert.match(reply.reply, /محصلش تأكيد/u);
  assert.doesNotMatch(reply.reply, /تم تسجيل طلب المعاينة بنجاح/u);
});

test("proximity comparison without matching verified landmark evidence cannot name a closer property", async () => {
  const unsafeModel: any = { available: () => true, compose: async () => ({ value: "East Gardens أقرب للجامعة الأمريكية.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }) };
  const guarded = new ResponseComposerService(unsafeModel);
  const current = state({ comparisonUnitIds: ["u1", "u2"] });
  const result = await guarded.compose({ userMessage: "مين الأقرب للجامعة الأمريكية؟", understanding: { intent: "COMPARISON", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false }, state: current, plan: { goal: "COMPARISON", steps: [{ tool: "COMPARE_PROPERTIES", arguments: { unitIds: ["u1", "u2"] } }] }, toolResults: [{ tool: "COMPARE_PROPERTIES", ok: true, data: [{ id: "u1", project: { name: "East Gardens" }, proximities: [] }, { id: "u2", project: { name: "Cairo Heights" }, proximities: [] }], latencyMs: 1 }], proposedActions: [], executedActions: [] });
  assert.match(result.reply, /(?:معنديش مسافة موثقة|do not have a verified distance)/iu);
  assert.doesNotMatch(result.reply, /East Gardens أقرب/iu);
});

test("media composition exposes verified URLs, reports missing assets, and rejects delivery promises", async () => {
  const unsafeModel: any = { available: () => true, compose: async () => ({ value: "هبعتلك الصور والماستر بلان واللوكيشن.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }) };
  const guarded = new ResponseComposerService(unsafeModel);
  const current = state({ selectedUnitId: "u1" });
  const result = await guarded.compose({ userMessage: "ابعتلي الصور والماستر بلان واللوكيشن", understanding: { intent: "MEDIA_REQUEST", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false }, state: current, plan: { goal: "MEDIA_REQUEST", steps: [{ tool: "GET_MEDIA", arguments: { unitId: "u1" } }] }, toolResults: [{ tool: "GET_MEDIA", ok: true, data: { media: [{ type: "IMAGE", url: "https://assets.example/unit.jpg" }], location: { latitude: null, longitude: null } }, latencyMs: 1 }], proposedActions: [], executedActions: [] });
  assert.match(result.reply, /https:\/\/assets\.example\/unit\.jpg/u);
  assert.match(result.reply, /(?:مفيش ماستر بلان|No verified master plan)/iu);
  assert.match(result.reply, /(?:مش عندي لوكيشن دقيق|No precise verified location)/iu);
  assert.doesNotMatch(result.reply, /هبعتلك/u);
});

test("absent media and failed media retrieval never claim that anything was sent", async () => {
  for (const toolResult of [{ tool: "GET_MEDIA", ok: true, data: { media: [], location: null }, latencyMs: 1 }, { tool: "GET_MEDIA", ok: false, errorCode: "TOOL_EXECUTION_FAILED", latencyMs: 1 }] as const) {
    const selected = state({ selectedUnitId: "u1" });
    const result = await composer.compose({ userMessage: "ابعتلي الصور والماستر بلان واللوكيشن", understanding: { intent: "MEDIA_REQUEST", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false }, state: selected, plan: { goal: "MEDIA_REQUEST", steps: [{ tool: "GET_MEDIA", arguments: { unitId: "u1" } }] }, toolResults: [toolResult], proposedActions: [], executedActions: [] });
    assert.doesNotMatch(result.reply, /(?:بعتلك|هبعتلك|هيوصلك|sent|delivered)/iu);
  }
});

test("22 human handoff is proposed but not fabricated", async () => {
  const intent = await understand("عايز حد من المبيعات");
  const policy = actionPolicy();
  const proposal = policy.propose(intent, state())[0];
  assert.equal(proposal.type, "HUMAN_HANDOFF");
});

test("23 invalid gateway secret is unauthorized", () => {
  const previous = process.env.NADIM_GATEWAY_SECRET;
  process.env.NADIM_GATEWAY_SECRET = "correct";
  const context: any = { switchToHttp: () => ({ getRequest: () => ({ headers: { "x-nadim-gateway-secret": "wrong" } }) }) };
  assert.throws(() => new NadimGatewayGuard().canActivate(context), (error: any) => error.getStatus() === 401);
  if (previous === undefined) delete process.env.NADIM_GATEWAY_SECRET; else process.env.NADIM_GATEWAY_SECRET = previous;
});

test("24 explicit existing conversation continues persisted V2 state", async () => {
  const stored = state({ revision: 4, lastResultIds: ["u1"] });
  const prisma: any = {
    customer: { findUnique: async () => null },
    customerChannelIdentity: { findUnique: async () => null },
    nadimConversation: { findUnique: async () => ({ id: "c1", customerId: null, state: stored, channel: "WEB" }) },
    nadimTurn: { findMany: async () => [{
      userMessage: "عايز شقة",
      assistantReply: "مش ظاهر حاجة مناسبة.",
      intent: { intent: "PROPERTY_SEARCH", responseGoal: "SEARCH_VERIFIED_INVENTORY" },
      plan: { goal: "PROPERTY_SEARCH" },
      toolResults: [{ tool: "PROPERTY_SEARCH", ok: true, data: [] }],
    }] },
  };
  const result = await new NadimConversationService(prisma).resolve({ channel: "WEB", conversationId: "c1", message: "كمل" });
  assert.equal(result.state.revision, 4);
  assert.deepEqual(result.state.lastResultIds, ["u1"]);
  assert.deepEqual(result.previousTurn, { userMessage: "عايز شقة", assistantReply: "مش ظاهر حاجة مناسبة." });
  assert.equal(result.conversationContext.stage, "RESULTS_AVAILABLE");
  assert.equal(result.conversationContext.recentTurns[0].intent, "PROPERTY_SEARCH");
  assert.deepEqual(result.conversationContext.lastVerifiedToolSummary, [{ tool: "PROPERTY_SEARCH", ok: true, resultCount: 0, errorCode: undefined }]);
});

class FakeProvider {
  calls = 0;
  lastMessages: any[] = [];
  constructor(readonly provider: string, readonly model: string, private readonly response: string | Error, private readonly streamValues: Array<string | Error> = []) {}
  enabled() { return true; }
  configured() { return true; }
  async complete(messages: any[]) { this.calls += 1; this.lastMessages = messages; if (this.response instanceof Error) throw this.response; return this.response; }
  async *stream() { this.calls += 1; for (const value of this.streamValues) { if (value instanceof Error) throw value; yield value; } }
  async health() { return { provider: this.provider, enabled: true, configured: true, healthy: true, model: this.model }; }
}

const semanticGreetingJson = JSON.stringify({
  understood: true,
  understoodMeaning: "The customer is greeting Nadim.",
  responseGoal: "RETURN_THE_GREETING_BRIEFLY",
  conversationalType: "CONVERSATION",
  proposedIntent: null,
  proposedStateOperations: [],
  references: [],
  toolNeed: { required: false },
  clarification: { required: false },
  confidence: 0.96,
  ordinalReferences: [],
  recentContextUsed: true,
});

test("25 GLM is primary for contextual dialogue and receives compact redacted history", async () => {
  const glm = new FakeProvider("bedrock-glm", "zai.glm-5", semanticGreetingJson);
  const groq = new FakeProvider("groq", "llama", "unused");
  const current = state({ customerId: "customer-secret", externalUserId: "278425818370206@lid" });
  const context: NadimConversationContext = {
    stage: "ACTIVE_SEARCH",
    recentTurns: [{ user: "صباح الخير", assistant: "أهلًا.", intent: "GREETING", tools: [] }],
  };
  const dialogue = new DialogueModelService(glm as any, groq as any);
  const result = await dialogue.understand("فاكر؟", current, context);
  assert.equal(result.provider, "bedrock-glm");
  assert.equal(groq.calls, 0);
  const payload = glm.lastMessages.at(-1)?.content as string;
  assert.match(payload, /صباح الخير/u);
  assert.match(payload, /ACTIVE_SEARCH/u);
  assert.doesNotMatch(payload, /customer-secret|278425818370206/u);
  assert.match(String(glm.lastMessages[0]?.content), /Ordinary meaningful conversation does not need a dedicated intent/u);
  const composed = await dialogue.compose({ responseGoal: "BRIEF_SMALL_TALK" });
  assert.equal(composed.provider, "bedrock-glm");
  assert.equal(groq.calls, 0);
});

test("26 GLM failure falls back to Groq", async () => {
  const glm = new FakeProvider("bedrock-glm", "zai.glm-5", new DialogueProviderError("bedrock-glm", "HTTP_503"));
  const groq = new FakeProvider("groq", "secondary", semanticGreetingJson);
  const result = await new DialogueModelService(glm as any, groq as any).understand("hi", state());
  assert.equal(result.provider, "groq");
  assert.equal(result.fallbackUsed, true);
});

test("27 stream failure before a visible token falls back", async () => {
  const glm = new FakeProvider("bedrock-glm", "zai.glm-5", "", [new Error("before")]);
  const groq = new FakeProvider("groq", "secondary", "", ["fallback answer"]);
  const chunks: string[] = [];
  for await (const item of new DialogueModelService(glm as any, groq as any).composeStream({})) chunks.push(item.chunk);
  assert.deepEqual(chunks, ["fallback answer"]);
});

test("28 stream failure after output never mixes providers", async () => {
  const glm = new FakeProvider("bedrock-glm", "zai.glm-5", "", ["partial", new Error("after")]);
  const groq = new FakeProvider("groq", "secondary", "", ["must-not-appear"]);
  const iterator = new DialogueModelService(glm as any, groq as any).composeStream({})[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).value.chunk, "partial");
  await assert.rejects(() => iterator.next(), DialogueStreamInterruptedError);
  assert.equal(groq.calls, 0);
});

test("29 V2 disabled fails before any pipeline execution", async () => {
  const previous = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "false";
  const service = new NadimV2Service({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  await assert.rejects(() => service.turn({ channel: "WEB", message: "hi" }), (error: any) => error.getResponse().code === "NADIM_V2_DISABLED");
  if (previous === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = previous;
});

test("30 V2 route is separate and does not replace legacy controllers", () => {
  assert.equal(Reflect.getMetadata(PATH_METADATA, NadimV2Controller), "v2/nadim");
  assert.equal(Reflect.getMetadata(HTTP_CODE_METADATA, NadimV2Controller.prototype.turn), 200);
});

test("model output alone cannot authorize an action", async () => {
  const model: any = {
    available: () => true,
    understand: async () => ({
      value: {
        understood: true,
        understoodMeaning: "The customer may be asking to arrange a viewing.",
        responseGoal: "HANDLE_VIEWING_REQUEST",
        conversationalType: "STRUCTURED_REQUEST",
        proposedIntent: "VIEWING_REQUEST",
        proposedStateOperations: [], references: [], toolNeed: { required: false }, clarification: { required: false },
        confidence: 0.99, ordinalReferences: [], recentContextUsed: false,
      },
      provider: "test",
      model: "test",
      fallbackUsed: false,
      latencyMs: 1,
    }),
  };
  const understanding = (await new UnderstandingService(model).understand("tell me more", state())).understanding;
  assert.equal(understanding.intent, "VIEWING_REQUEST");
  assert.equal(understanding.actionRequested, false);
  assert.deepEqual(actionPolicy().propose(understanding, state()), []);
});

test("GLM health is safe when disabled and explicit when credentials are missing", async () => {
  const enabled = process.env.BEDROCK_GLM_ENABLED;
  const key = process.env.BEDROCK_API_KEY;
  process.env.BEDROCK_GLM_ENABLED = "false";
  delete process.env.BEDROCK_API_KEY;
  const disabled = await new BedrockGlmProvider().health();
    assert.equal(disabled.healthy, false);
    assert.equal(disabled.errorCode, "DISABLED");
  assert.equal(disabled.enabled, false);
  process.env.BEDROCK_GLM_ENABLED = "true";
  const missing = await new BedrockGlmProvider().health();
  assert.equal(missing.healthy, false);
  assert.equal(missing.errorCode, "NOT_CONFIGURED");
  if (enabled === undefined) delete process.env.BEDROCK_GLM_ENABLED; else process.env.BEDROCK_GLM_ENABLED = enabled;
  if (key === undefined) delete process.env.BEDROCK_API_KEY; else process.env.BEDROCK_API_KEY = key;
});

function idempotentHarness() {
  const rows = new Map<string, { hash: string; response?: any }>();
  const counters = { understand: 0, actions: 0, persist: 0 };
  const conversations: any = {
    replayIdempotent: async (channel: string, key: string, hash: string) => {
      const row = rows.get(`${channel}:${key}`);
      if (!row) return null;
      if (row.hash !== hash) throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT" });
      if (!row.response) throw new ConflictException({ code: "TURN_IN_PROGRESS" });
      return { ...row.response, replayed: true };
    },
    resolve: async (input: any) => ({ conversation: { id: `conversation-${input.channel}` }, state: initialNadimState({ channel: input.channel }), customerId: undefined }),
    claimIdempotent: async (input: any) => {
      const mapKey = `${input.channel}:${input.idempotencyKey}`;
      const existing = rows.get(mapKey);
      if (existing) return { replay: await conversations.replayIdempotent(input.channel, input.idempotencyKey, input.requestHash) };
      rows.set(mapKey, { hash: input.requestHash });
      return { turnId: mapKey };
    },
    persist: async (input: any) => {
      counters.persist += 1;
      if (input.idempotencyKey) rows.set(`${input.channel}:${input.idempotencyKey}`, { hash: input.requestHash, response: input.response });
    },
    markIdempotentFailed: async () => undefined,
  };
  const understanding: any = {
    understand: async () => {
      counters.understand += 1;
      return { understanding: { intent: "LEAD_REQUEST", confidence: 1, operations: [], ordinalReferences: [], actionRequested: true } };
    },
  };
  const actions: any = {
    propose: () => [{ type: "CREATE_LEAD", reason: "explicit", payload: {} }],
    execute: async () => {
      counters.actions += 1;
      return [{ type: "CREATE_LEAD", status: "SUCCEEDED", entityId: "lead-1" }];
    },
  };
  const service = new NadimV2Service(
    conversations,
    understanding,
    new StateEngineService(),
    { plan: () => ({ goal: "LEAD_REQUEST", steps: [] }) } as any,
    { execute: async () => [] } as any,
    actions,
    { compose: async () => ({ reply: "recorded" }) } as any,
  );
  return { service, counters };
}

test("first idempotent turn executes normally and an identical retry replays without duplicate actions", async () => {
  const enabled = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  try {
    const { service, counters } = idempotentHarness();
    const input = { channel: "WHATSAPP" as const, externalUserId: "wa-user", message: "كلمني", metadata: { eventId: "wa-message-123" } };
    const first = await service.turn(input, "request-1", "wa-message-123");
    const replay = await service.turn(input, "request-2", "wa-message-123");
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.reply, first.reply);
    assert.deepEqual(counters, { understand: 1, actions: 1, persist: 1 });
  } finally {
    if (enabled === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = enabled;
  }
});

test("the same idempotency key is independent across channels", async () => {
  const enabled = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  try {
    const { service, counters } = idempotentHarness();
    await service.turn({ channel: "WHATSAPP", message: "كلمني" }, "request-wa", "provider-event-1");
    await service.turn({ channel: "PHONE", message: "كلمني" }, "request-phone", "provider-event-1");
    assert.deepEqual(counters, { understand: 2, actions: 2, persist: 2 });
  } finally {
    if (enabled === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = enabled;
  }
});

test("reuse of an idempotency key with materially different input returns conflict", async () => {
  const enabled = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_V2_ENABLED = "true";
  try {
    const { service, counters } = idempotentHarness();
    await service.turn({ channel: "WHATSAPP", message: "كلمني" }, "request-1", "provider-event-2");
    await assert.rejects(
      () => service.turn({ channel: "WHATSAPP", message: "عايز شقة" }, "request-2", "provider-event-2"),
      (error: any) => error.getStatus() === 409 && error.getResponse().code === "IDEMPOTENCY_CONFLICT",
    );
    assert.deepEqual(counters, { understand: 1, actions: 1, persist: 1 });
  } finally {
    if (enabled === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = enabled;
  }
});

test("property requirement is persisted before search and survives tool failure; verified no-match becomes NEEDS_MATCH", async () => {
  const enabled = process.env.NADIM_V2_ENABLED; process.env.NADIM_V2_ENABLED = "true";
  try {
    for (const [toolResult, expectedStatus] of [[{ tool: "PROPERTY_SEARCH", ok: false, errorCode: "TOOL_EXECUTION_FAILED", latencyMs: 1 }, undefined], [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }, "NEEDS_MATCH"]] as const) {
      const order: string[] = []; const statuses: string[] = [];
      const lifecycle: any = { saveRequirement: async () => { order.push("requirement"); return { id: "requirement-1" }; }, setRequirementStatus: async (_id: string, status: string) => { statuses.push(status); } };
      const service = new NadimV2Service(
        { replayIdempotent: async () => null, resolve: async () => ({ conversation: { id: "c1", mode: "AI" }, state: initialNadimState({ channel: "WEB", locale: "ar-EG" }) }), persist: async () => undefined } as any,
        { understand: async () => ({ understanding: { intent: "PROPERTY_SEARCH", confidence: 1, operations: [{ operation: "SET", field: "locations", value: ["التجمع"] }, { operation: "SET", field: "propertyTypes", value: ["Apartment"] }, { operation: "SET", field: "bedrooms", value: 3 }], ordinalReferences: [], actionRequested: false } }) } as any,
        new StateEngineService(), new PlannerService(), { execute: async () => { order.push("search"); return [toolResult]; } } as any,
        { propose: () => [], execute: async () => [] } as any, { compose: async () => ({ reply: "safe", providerLatencyMs: 0 }) } as any,
        undefined, undefined, undefined, lifecycle,
      );
      await service.turn({ channel: "WEB", message: "عايز شقة 3 غرف في التجمع", locale: "ar-EG" });
      assert.deepEqual(order, ["requirement", "search"]);
      assert.deepEqual(statuses, expectedStatus ? [expectedStatus] : []);
    }
  } finally { if (enabled === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = enabled; }
});

test("controller accepts a trimmed header key and derives one from canonical metadata", async () => {
  const calls: any[] = [];
  const controller = new NadimV2Controller({ turn: async (...args: any[]) => { calls.push(args); return {}; } } as any);
  await controller.turn({ channel: "WHATSAPP", message: "hi" }, { requestId: "r1" }, " wa-message-123 ");
  await controller.turn({ channel: "PHONE", message: "hi", metadata: { eventId: "call-event-9" } }, { requestId: "r2" });
  assert.equal(calls[0][2], "wa-message-123");
  assert.equal(calls[1][2], "call-event-9");
});

test("multi-turn cheapest search preserves constraints after explicit removal", async () => {
  const turn1Intent = await understand("عايز شقة في التجمع 3 غرف تحت 8 مليون");
  const turn1 = stateEngine.apply(state(), turn1Intent, { channel: "WEB" });
  const turn2 = stateEngine.apply(turn1, await understand("خلي الميزانية 10", turn1), { channel: "WEB" });
  const turn3 = stateEngine.apply(turn2, await understand("مش مهم التجمع", turn2), { channel: "WEB" });
  const finalIntent = await understand("وريني الأرخص", turn3);
  const turn4 = stateEngine.apply(turn3, finalIntent, { channel: "WEB" });
  assert.deepEqual(turn4.search.locations, []);
  assert.equal(turn4.search.bedrooms, 3);
  assert.equal(turn4.search.budgetMax, 10_000_000);
  assert.equal(turn4.search.queryObjective, "CHEAPEST");
  assert.equal(planner.plan(finalIntent, turn4).steps[0].tool, "PROPERTY_SEARCH");
});

test("assistant nature is transparent, conversational, state-preserving, and tool-free", async () => {
  const active = state({
    revision: 3,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
  });
  const message = "يعني كدا انت مو انسان";
  const styled = languageStyles.apply(active, message);
  const intent = await understand(message, styled);
  const next = stateEngine.apply(styled, intent, { channel: "WEB" });
  const plan = planner.plan(intent, next);
  const response = await composer.compose({ userMessage: message, understanding: intent, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });

  assert.equal(intent.intent, "ASSISTANT_NATURE");
  assert.deepEqual(next.search, active.search);
  assert.deepEqual(plan.steps, []);
  assert.match(response.reply, /(?:ذكاء\s+اصطناعي|AI)/iu);
  assert.match(response.reply, /نديم/u);
  assert.doesNotMatch(response.reply, /أنا\s+إنسان/u);

  const noisyCapabilities = await understand("انت الزائر تقدر تساعدني باي", active);
  assert.equal(noisyCapabilities.intent, "ASSISTANT_CAPABILITIES");
  assert.deepEqual(planner.plan(noisyCapabilities, stateEngine.apply(active, noisyCapabilities, { channel: "WEB" })).steps, []);
});

test("conversation-memory and vague price references resolve from recent dialogue without inventory", async () => {
  const active = state({
    revision: 4,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
  });
  const memoryContext: NadimConversationContext = {
    stage: "ACTIVE_SEARCH",
    recentTurns: [{ user: "عايز شقة 3 غرف في التجمع تحت 8 مليون", assistant: "مش ظاهر حاجة مناسبة.", intent: "PROPERTY_SEARCH", responseGoal: "SEARCH_VERIFIED_INVENTORY", tools: [{ tool: "PROPERTY_SEARCH", ok: true, resultCount: 0 }] }],
  };
  const memoryIntent = (await understandingService.understand("طب فاكر انا كنت بدور علي اي", active, {}, memoryContext)).understanding;
  const afterMemory = stateEngine.apply(active, memoryIntent, { channel: "WEB" });
  const memoryReply = await composer.compose({ userMessage: "طب فاكر انا كنت بدور علي اي", understanding: memoryIntent, state: afterMemory, plan: planner.plan(memoryIntent, afterMemory), toolResults: [], proposedActions: [], executedActions: [], conversationContext: memoryContext });

  assert.equal(memoryIntent.intent, "CURRENT_SEARCH_QUERY");
  assert.equal(memoryIntent.stateQuery, "SEARCH");
  assert.deepEqual(planner.plan(memoryIntent, afterMemory).steps, []);
  assert.match(memoryReply.reply, /شقة/u);
  assert.match(memoryReply.reply, /3/u);
  assert.match(memoryReply.reply, /التجمع/u);
  assert.match(memoryReply.reply, /8\s*مليون|8,000,000/u);

  const priceContext: NadimConversationContext = {
    stage: "ACTIVE_SEARCH",
    recentTurns: [...memoryContext.recentTurns, {
      user: "طب فاكر انا كنت بدور علي اي",
      assistant: memoryReply.reply,
      intent: "CURRENT_SEARCH_QUERY",
      stateQuery: "SEARCH",
      responseGoal: "SUMMARIZE_CURRENT_SEARCH",
      tools: [],
    }],
  };
  const priceIntent = (await understandingService.understand("السعر كان كام", afterMemory, {}, priceContext)).understanding;
  const afterPrice = stateEngine.apply(afterMemory, priceIntent, { channel: "WEB" });
  assert.equal(priceIntent.intent, "CURRENT_SEARCH_QUERY");
  assert.equal(priceIntent.stateQuery, "budgetMax");
  assert.equal(priceIntent.references?.[0]?.resolvedAs, "SEARCH_BUDGET");
  assert.equal(priceIntent.recentContextUsed, true);
  assert.deepEqual(planner.plan(priceIntent, afterPrice).steps, []);

  const ambiguous = state({ ...active, selectedUnitId: "unit-1" });
  const ambiguousIntent = await understand("السعر كان كام", ambiguous);
  assert.equal(ambiguousIntent.ambiguity, "PRICE_REFERENCE_AMBIGUOUS");
  assert.equal(planner.plan(ambiguousIntent, stateEngine.apply(ambiguous, ambiguousIntent, { channel: "WEB" })).clarification, "PRICE_REFERENCE_AMBIGUOUS");

  const selectedState = state({ ...active, selectedUnitId: "unit-2", lastResultIds: ["unit-1", "unit-2"] });
  const selectedQuery = await understand("فاكر اختارت انهي واحدة", selectedState);
  const selectedReply = await composer.compose({ userMessage: "فاكر اختارت انهي واحدة", understanding: selectedQuery, state: selectedState, plan: planner.plan(selectedQuery, selectedState), toolResults: [], proposedActions: [], executedActions: [] });
  assert.equal(selectedQuery.intent, "CURRENT_SEARCH_QUERY");
  assert.equal(selectedQuery.stateQuery, "SELECTED_RESULT");
  assert.deepEqual(planner.plan(selectedQuery, selectedState).steps, []);
  assert.match(selectedReply.reply, /2/u);
});

test("noisy first-option references use recent results and remain honest without a result list", async () => {
  const withResults = state({ lastResultIds: ["unit-1", "unit-2"] });
  const selectedIntent = await understand("الاوليه", withResults);
  const selected = stateEngine.apply(withResults, selectedIntent, { channel: "WEB" });
  assert.equal(selected.selectedUnitId, "unit-1");
  assert.equal(planner.plan(selectedIntent, selected).steps[0]?.tool, "GET_UNIT_FACTS");

  const withoutResults = state();
  const missingIntent = await understand("الاوليه", withoutResults);
  const missing = stateEngine.apply(withoutResults, missingIntent, { channel: "WEB" });
  const missingPlan = planner.plan(missingIntent, missing);
  const response = await composer.compose({ userMessage: "الاوليه", understanding: missingIntent, state: missing, plan: missingPlan, toolResults: [], proposedActions: [], executedActions: [] });
  assert.equal(missingPlan.clarification, "RESULT_LIST_EMPTY");
  assert.deepEqual(missingPlan.steps, []);
  assert.match(response.reply, /(?:لسه|ما ظهرت|لم تظهر).*(?:اختيارات|خيارات)/u);
  assert.doesNotMatch(response.reply, /(?:حدد الوحدة|الرقم اللي ظاهر)/u);
});

test("conversational model composition is active but cannot claim Nadim is human or alter state facts", async () => {
  const nature: NadimUnderstanding = { intent: "ASSISTANT_NATURE", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false, references: [], needsTool: false, needsClarification: false, recentContextUsed: true };
  const naturalModel: any = {
    available: () => true,
    compose: async () => ({ value: "أيوه، أنا نديم، مساعد ذكاء اصطناعي بساعدك في بحثك العقاري.", provider: "groq", model: "test", fallbackUsed: false, latencyMs: 2 }),
  };
  const current = state({ revision: 2 });
  const natural = await new ResponseComposerService(naturalModel).compose({ userMessage: "انت انسان؟", understanding: nature, state: current, plan: { goal: "ASSISTANT_NATURE", steps: [] }, toolResults: [], proposedActions: [], executedActions: [] });
  assert.equal(natural.model?.provider, "groq");
  assert.match(natural.reply, /ذكاء\s+اصطناعي/u);

  const unsafeModel: any = {
    available: () => true,
    compose: async () => ({ value: "أنا إنسان واسمي نديم.", provider: "groq", model: "test", fallbackUsed: false, latencyMs: 2 }),
  };
  const guarded = await new ResponseComposerService(unsafeModel).compose({ userMessage: "انت انسان؟", understanding: nature, state: current, plan: { goal: "ASSISTANT_NATURE", steps: [] }, toolResults: [], proposedActions: [], executedActions: [] });
  assert.match(guarded.reply, /ذكاء\s+اصطناعي/u);
  assert.doesNotMatch(guarded.reply, /أنا\s+إنسان/u);

  const stateQuery: NadimUnderstanding = { intent: "CURRENT_SEARCH_QUERY", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false, stateQuery: "budgetMax", references: [], needsTool: false, needsClarification: false, recentContextUsed: true };
  const wrongFactModel: any = {
    available: () => true,
    compose: async () => ({ value: "الميزانية كانت 12 مليون.", provider: "groq", model: "test", fallbackUsed: false, latencyMs: 2 }),
  };
  const budgetState = state({ search: { locations: [], projects: [], developers: [], propertyTypes: [], budgetMax: 8_000_000 } });
  const grounded = await new ResponseComposerService(wrongFactModel).compose({ userMessage: "الميزانية كام؟", understanding: stateQuery, state: budgetState, plan: { goal: "CURRENT_SEARCH_QUERY", steps: [] }, toolResults: [], proposedActions: [], executedActions: [] });
  assert.match(grounded.reply, /8\s*مليون|8,000,000/u);
  assert.doesNotMatch(grounded.reply, /12\s*مليون/u);
});

test("realistic nine-turn customer-service conversation stays contextual and fact-grounded", async () => {
  let current = state();
  const history: NadimRecentTurnContext[] = [];
  const outputs: Array<{ message: string; reply: string; intent: string; tools: string[] }> = [];
  let searchExecutions = 0;

  const runTurn = async (message: string) => {
    const styled = languageStyles.apply(current, message);
    const context: NadimConversationContext = { stage: conversationStage(styled), recentTurns: history.slice(-8) };
    const understanding = (await understandingService.understand(message, styled, {}, context)).understanding;
    let next = stateEngine.apply(styled, understanding, { channel: "WEB" });
    const plan = planner.plan(understanding, next);
    const toolResults = plan.steps.map((step) => {
      assert.equal(step.tool, "PROPERTY_SEARCH");
      searchExecutions += 1;
      return { tool: "PROPERTY_SEARCH" as const, ok: true, data: [], latencyMs: 1 };
    });
    if (plan.goal === "PROPERTY_SEARCH") next = stateEngine.withResults(next, []);
    const response = await composer.compose({ userMessage: message, understanding, state: next, plan, toolResults, proposedActions: [], executedActions: [], conversationContext: context });
    current = stateEngine.withAssistantWording(next, response.reply);
    history.push({
      user: message,
      assistant: response.reply,
      intent: understanding.intent,
      stateQuery: understanding.stateQuery,
      responseGoal: understanding.responseGoal,
      tools: toolResults.map((result) => ({ tool: result.tool, ok: result.ok, resultCount: 0 })),
    });
    outputs.push({ message, reply: response.reply, intent: understanding.intent, tools: plan.steps.map((step) => step.tool) });
    return outputs.at(-1)!;
  };

  await runTurn("صباح الخير");
  await runTurn("تكلم مصري");
  await runTurn("انت تقدر تساعدني بايه");
  await runTurn("يعني كدا انت مو انسان");
  await runTurn("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  await runTurn("طب فاكر انا كنت بدور علي اي");
  await runTurn("السعر كان كام");
  await runTurn("لا خليها 10 مليون");
  const final = await runTurn("فاكر وصلنا لفين");

  assert.equal(current.revision, 9);
  assert.equal(current.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.equal(current.search.budgetMax, 10_000_000);
  assert.equal(current.search.bedrooms, 3);
  assert.deepEqual(current.search.locations, ["التجمع"]);
  assert.deepEqual(current.search.propertyTypes, ["Apartment"]);
  assert.equal(searchExecutions, 2);
  assert.equal(outputs.some((turn) => turn.intent === "UNKNOWN"), false);
  assert.deepEqual(outputs.filter((turn) => turn.tools.length > 0).map((turn) => turn.message), [
    "عايز شقة 3 غرف في التجمع تحت 8 مليون",
    "لا خليها 10 مليون",
  ]);
  assert.equal(outputs[3].intent, "ASSISTANT_NATURE");
  assert.match(outputs[3].reply, /ذكاء\s+اصطناعي/u);
  assert.equal(outputs[5].intent, "CURRENT_SEARCH_QUERY");
  assert.equal(outputs[6].intent, "CURRENT_SEARCH_QUERY");
  assert.match(outputs[6].reply, /8\s*مليون|8,000,000/u);
  assert.equal(final.intent, "CURRENT_SEARCH_QUERY");
  assert.match(final.reply, /شقة/u);
  assert.match(final.reply, /3/u);
  assert.match(final.reply, /التجمع/u);
  assert.match(final.reply, /10\s*مليون|10,000,000/u);
});

test("live Arabic product commands retain semantic routing during provider outage", async () => {
  const compared = state({ comparisonUnitIds: ["unit-1", "unit-2"], lastResultIds: ["unit-1", "unit-2"] });
  assert.equal((await understand("مين فيهم أقرب للجامعة الأمريكية؟", compared)).intent, "COMPARISON");
  assert.equal((await understand("في صور للأول؟", compared)).intent, "MEDIA_REQUEST");
  const share = await understand("هاتلي رابط المحادثة", compared);
  assert.equal(share.proposedActions?.[0]?.type, "CREATE_CONVERSATION_SHARE_LINK");
  const human = await understand("عايز حد من خدمة العملاء يكلمني", compared);
  assert.equal(human.intent, "HUMAN_HANDOFF");
  const deletion = await understand("امسح المحادثة", compared);
  assert.equal(deletion.proposedActions?.[0]?.type, "REQUEST_CONVERSATION_DELETION");
  for (const result of [share, human, deletion]) assert.notEqual(result.responseGoal, "CONTINUE_CONVERSATION_SAFELY");
});

test("pending delete confirmation and multi-intent requirement plus follow-up produce separate executable actions", async () => {
  const pendingContext: NadimConversationContext = {
    stage: "ACTIVE_SEARCH", recentTurns: [],
    pendingDeletion: { requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() },
  };
  const confirmation = (await understandingService.understand("ايوه امسحها", state(), {}, pendingContext)).understanding;
  assert.equal(confirmation.proposedActions?.[0]?.type, "CONFIRM_CONVERSATION_DELETION");
  const combined = await understand("عايز فيلا في زايد لحد 25 مليون وتابع معايا بعد نص ساعة");
  assert.equal(combined.intent, "PROPERTY_SEARCH");
  assert.ok(combined.operations.some((operation) => operation.field === "propertyTypes"));
  assert.equal(combined.proposedActions?.some((action) => action.type === "CREATE_FOLLOWUP"), true);
  const followUpAndShare = await understand("تابع معايا بعد نص ساعة وهاتلي رابط المحادثة");
  assert.deepEqual(new Set(followUpAndShare.proposedActions?.map((action) => action.type)), new Set(["CREATE_FOLLOWUP", "CREATE_CONVERSATION_SHARE_LINK"]));
});

test("structured UI is derived only from verified tool and successful action results", () => {
  const properties = [{ id: "u1", project: { name: "East Gardens" }, price: 7_900_000 }];
  const ui = buildNadimUi(
    [{ tool: "PROPERTY_SEARCH", ok: true, data: properties, latencyMs: 1 }, { tool: "GET_MEDIA", ok: false, errorCode: "FAILED", latencyMs: 1 }],
    [{ type: "CREATE_CONVERSATION_SHARE_LINK", status: "SUCCEEDED", message: "https://example.test/c/token" }],
  );
  assert.deepEqual(ui.map((item) => item.type), ["PROPERTY_RESULTS", "SHARE_LINK"]);
  assert.deepEqual((ui[0] as any).data.properties, properties);
});

test("saved requirement lists are answered from persisted customer context", async () => {
  const current = state();
  const answer = await composer.compose({
    userMessage: "طلباتى إيه؟",
    understanding: { intent: "CURRENT_SEARCH_QUERY", confidence: 1, operations: [], ordinalReferences: [], actionRequested: false },
    state: current,
    plan: { goal: "CURRENT_SEARCH_QUERY", steps: [] }, toolResults: [], proposedActions: [], executedActions: [],
    conversationContext: { stage: "DISCOVERY", recentTurns: [], customerContext: { propertyRequirements: [
      { propertyType: "Apartment", bedrooms: 3, locations: ["التجمع"], budgetMax: 12_000_000, currency: "EGP" },
      { propertyType: "Villa", locations: ["زايد"], budgetMax: 25_000_000, currency: "EGP" },
    ] } },
  });
  assert.match(answer.reply, /1\. شقة/u);
  assert.match(answer.reply, /2\. فيلا/u);
  assert.match(answer.reply, /12,000,000/u);
  assert.match(answer.reply, /25,000,000/u);
});
