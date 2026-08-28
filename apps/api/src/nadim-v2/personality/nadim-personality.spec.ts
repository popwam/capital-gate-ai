import * as assert from "node:assert/strict";
import { test } from "node:test";
import { ResponseComposerService } from "../brain/response-composer.service";
import { PlannerService } from "../brain/planner.service";
import { StateEngineService } from "../brain/state-engine.service";
import { UnderstandingService } from "../brain/understanding.service";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { initialNadimState, NadimState } from "../domain/nadim-state";
import { LanguageStyleDetectorService } from "./language-style-detector.service";
import { NadimLanguageStyle } from "./language-style.types";
import { ResponseStyleService } from "./response-style.service";

const noModel: any = { available: () => false };
const composer = new ResponseComposerService(noModel, new ResponseStyleService());
const detector = new LanguageStyleDetectorService();
const stateEngine = new StateEngineService();
const planner = new PlannerService();

function styledState(style: NadimLanguageStyle, overrides: Partial<NadimState> = {}): NadimState {
  const base = initialNadimState({ channel: "WEB", locale: style === "EN_US" ? "en-US" : "ar-EG" });
  return {
    ...base,
    ...overrides,
    languageStyle: {
      inputLanguage: style,
      detected: style,
      confidence: 0.99,
      preferredResponseStyle: style,
      explicitOverride: false,
      explicitRequestThisTurn: false,
      changedThisTurn: false,
      grammaticalAddress: "NEUTRAL",
      grammaticalAddressExplicit: false,
      grammaticalAddressChangedThisTurn: false,
    },
  };
}

function understanding(intent: NadimUnderstanding["intent"], operations: NadimUnderstanding["operations"] = []): NadimUnderstanding {
  return { intent, confidence: 1, operations, ordinalReferences: [], actionRequested: false };
}

async function compose(input: {
  style: NadimLanguageStyle;
  intent: NadimUnderstanding["intent"];
  goal?: string;
  message?: string;
  state?: Partial<NadimState>;
  plan?: NadimPlan;
  tools?: NadimToolResult[];
  operations?: NadimUnderstanding["operations"];
  proposedActions?: any[];
  executedActions?: any[];
}) {
  const current = styledState(input.style, input.state);
  const parsed = understanding(input.intent, input.operations);
  return composer.compose({
    userMessage: input.message ?? "test",
    understanding: parsed,
    state: current,
    plan: input.plan ?? { goal: input.goal ?? input.intent, steps: [] },
    toolResults: input.tools ?? [],
    proposedActions: input.proposedActions ?? [],
    executedActions: input.executedActions ?? [],
  });
}

test("language detector identifies input language without treating it as response consent", () => {
  const cases: Array<[string, NadimLanguageStyle]> = [
    ["عايز شقة 3 غرف في التجمع تحت 8 مليون", "AR_EGYPTIAN"],
    ["أبي شقة 3 غرف وودي تكون بالتقسيط", "AR_GULF"],
    ["أرغب في معرفة الوحدات المتاحة", "AR_FORMAL"],
    ["I need a 3-bedroom apartment in New Cairo under 8 million EGP", "EN_US"],
    ["3ayz sho2a 3 rooms fel tagamo3 ta7t 8 million", "FRANCO_ARABIC"],
    ["عايز apartment 3 bedrooms في التجمع", "MIXED_AR_EN"],
  ];
  for (const [message, expected] of cases) {
    const resolved = detector.detect(message);
    assert.equal(resolved.inputLanguage, expected, message);
    assert.equal(resolved.preferredResponseStyle, "AR_FORMAL", message);
  }
});

test("Latin noise is UNKNOWN and keeps the established conversational style", () => {
  for (const style of ["AR_EGYPTIAN", "AR_GULF", "EN_US", "FRANCO_ARABIC"] as const) {
    const previous = styledState(style);
    for (const message of ["svgsvg", "asdf", "lolll"]) {
      const next = detector.apply(previous, message);
      assert.equal(next.languageStyle.detected, "UNKNOWN", `${style}: ${message}`);
      assert.equal(next.languageStyle.preferredResponseStyle, style, `${style}: ${message}`);
    }
  }
  assert.equal(detector.detect("I need an apartment").inputLanguage, "EN_US");
  assert.equal(detector.detect("3ayz sho2a").inputLanguage, "FRANCO_ARABIC");
  assert.equal(detector.apply(styledState("FRANCO_ARABIC"), "khalyha").languageStyle.preferredResponseStyle, "FRANCO_ARABIC");
});

test("locale is only a fallback and explicit language requests remain authoritative", () => {
  const gulfLocale = initialNadimState({ channel: "WEB", locale: "ar-SA" });
  assert.equal(gulfLocale.languageStyle.preferredResponseStyle, "AR_GULF");
  const egyptianInput = detector.apply(gulfLocale, "عايز شقة", "ar-SA").languageStyle;
  assert.equal(egyptianInput.inputLanguage, "AR_EGYPTIAN");
  assert.equal(egyptianInput.preferredResponseStyle, "AR_GULF");

  const explicitEnglish = detector.apply(gulfLocale, "Explain the payment plan in English");
  assert.equal(explicitEnglish.languageStyle.preferredResponseStyle, "EN_US");
  assert.equal(explicitEnglish.languageStyle.explicitOverride, true);
  const followingArabic = detector.apply(explicitEnglish, "سعر الوحدة كام؟");
  assert.equal(followingArabic.languageStyle.detected, "UNKNOWN");
  assert.equal(followingArabic.languageStyle.preferredResponseStyle, "EN_US");

  const explicitCases: Array<[string, NadimLanguageStyle]> = [
    ["كمل مصري", "AR_EGYPTIAN"],
    ["رد بالمصري", "AR_EGYPTIAN"],
    ["كلمني خليجي", "AR_GULF"],
    ["رد بالعربي", "AR_FORMAL"],
    ["رد بالإنجليزي", "EN_US"],
    ["رد عليا بالإنجليزي", "EN_US"],
    ["كلمّني إنجليزي", "EN_US"],
    ["continue in English", "EN_US"],
    ["Speak English", "EN_US"],
    ["كمل خليجي", "AR_GULF"],
    ["Back to Arabic", "AR_FORMAL"],
    ["كلمني فرانكو", "FRANCO_ARABIC"],
    ["kamel franco", "FRANCO_ARABIC"],
  ];
  for (const [message, expected] of explicitCases) assert.equal(detector.detect(message).preferredResponseStyle, expected, message);
});

test("first inbound greetings may introduce Nadim but direct searches never do", async () => {
  const greeting = await compose({ style: "AR_EGYPTIAN", intent: "GREETING", message: "السلام عليكم", state: { revision: 1 } });
  assert.match(greeting.reply, /أنا نديم/u);

  const unit = { id: "u1", externalUnitId: "NC-A", bedrooms: 3, price: 7_400_000, currency: "EGP" };
  const search = await compose({
    style: "AR_EGYPTIAN",
    intent: "PROPERTY_SEARCH",
    message: "عايز شقة في التجمع",
    goal: "PROPERTY_SEARCH",
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [unit], latencyMs: 1 }],
  });
  assert.match(search.reply, /لقيتلك/u);
  assert.doesNotMatch(search.reply, /أنا نديم/u);

  const englishSearch = await compose({
    style: "EN_US",
    intent: "PROPERTY_SEARCH",
    message: "I need a 3-bedroom apartment",
    goal: "PROPERTY_SEARCH",
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [unit], latencyMs: 1 }],
  });
  assert.match(englishSearch.reply, /I found/u);
  assert.doesNotMatch(englishSearch.reply, /I(?:’|')m Nadim/u);
});

test("each style stays natural, distinct, and concise", async () => {
  const unit = { id: "u1", externalUnitId: "NC-A", bedrooms: 3, price: 7_400_000, currency: "EGP" };
  const render = (style: NadimLanguageStyle) => compose({
    style,
    intent: "PROPERTY_SEARCH",
    goal: "PROPERTY_SEARCH",
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [unit], latencyMs: 1 }],
  });
  const egyptian = (await render("AR_EGYPTIAN")).reply;
  const gulf = (await render("AR_GULF")).reply;
  const formal = (await render("AR_FORMAL")).reply;
  const english = (await render("EN_US")).reply;
  const franco = (await render("FRANCO_ARABIC")).reply;
  const mixed = (await render("MIXED_AR_EN")).reply;

  assert.match(egyptian, /لقيتلك/u);
  assert.match(gulf, /لقيت لك/u);
  assert.doesNotMatch(gulf, /(?:خليني|شوفلك|التانية|مفيش|عايز)/u);
  assert.match(formal, /وجدت/u);
  assert.doesNotMatch(formal, /(?:لقيتلك|مفيش|عايز)/u);
  assert.match(english, /I found/u);
  assert.match(franco, /la2etlak/u);
  assert.doesNotMatch(franco, /[\u0600-\u06FF]/u);
  assert.match(mixed, /options?/u);
  assert.match(mixed, /[\u0600-\u06FF]/u);
  for (const reply of [egyptian, gulf, formal, english, franco, mixed]) assert.ok(reply.length < 500, reply);
});

test("explicit language switching preserves every property-search constraint", () => {
  const first = detector.apply(styledState("AR_EGYPTIAN", {
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
    selectedUnitId: "unit-1",
    lastResultIds: ["unit-1", "unit-2"],
  }), "عايز شقة في التجمع");
  const originalSearch = structuredClone(first.search);

  const english = detector.apply(first, "Explain the payment plan in English");
  assert.equal(english.languageStyle.preferredResponseStyle, "EN_US");
  assert.deepEqual(english.search, originalSearch);
  assert.equal(english.selectedUnitId, "unit-1");

  const egyptian = detector.apply(english, "كمل مصري");
  assert.equal(egyptian.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(egyptian.search, originalSearch);
  assert.deepEqual(egyptian.lastResultIds, ["unit-1", "unit-2"]);
});

test("a language-only instruction never becomes a callback or action request", async () => {
  const previous = detector.apply(styledState("AR_EGYPTIAN"), "كلمني خليجي");
  const result = await new UnderstandingService(noModel).understand("كلمني خليجي", previous);
  assert.equal(result.understanding.intent, "LANGUAGE_STYLE_CHANGE");
  assert.equal(result.understanding.actionRequested, false);
});

test("style cannot alter trusted unit facts, result IDs, selection, or payment facts", async () => {
  const styles: NadimLanguageStyle[] = ["AR_EGYPTIAN", "AR_GULF", "EN_US", "FRANCO_ARABIC"];
  const unit = { id: "unit-1", externalUnitId: "NC-A", unitType: "Apartment", bedrooms: 3, bathrooms: 2, builtUpArea: 155, price: 7_400_000, currency: "EGP", project: { name: "Palm Hills" } };
  for (const style of styles) {
    const current = styledState(style, { selectedUnitId: "unit-1", lastResultIds: ["unit-1"] });
    const before = structuredClone(current);
    const result = await composer.compose({
      userMessage: "search",
      understanding: understanding("PROPERTY_SEARCH"),
      state: current,
      plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
      toolResults: [{ tool: "PROPERTY_SEARCH", ok: true, data: [unit], latencyMs: 1 }],
      proposedActions: [],
      executedActions: [],
    });
    for (const fact of ["NC-A", "3", "2", "155 m²", "7.4", "Palm Hills"]) assert.match(result.reply, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${style}: ${fact}`);
    assert.doesNotMatch(result.reply, /7,400,000 EGP/u);
    if (style === "AR_EGYPTIAN" || style === "AR_GULF") {
      assert.match(result.reply, /شقة/u);
      assert.doesNotMatch(result.reply, /Apartment/u);
    }
    assert.deepEqual(current, before);

    const payment = await compose({
      style,
      intent: "PAYMENT_PLAN_QUESTION",
      plan: { goal: "PAYMENT_PLAN_QUESTION", steps: [{ tool: "GET_PAYMENT_PLAN", arguments: { unitId: "unit-1" } }] },
      tools: [{ tool: "GET_PAYMENT_PLAN", ok: true, data: [{ name: "Plan A", downPaymentPercent: 10, durationMonths: 96, installmentAmount: 75_000, currency: "EGP" }], latencyMs: 1 }],
    });
    for (const fact of ["Plan A", "10%", "96", "75,000"]) assert.match(payment.reply, new RegExp(fact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${style}: ${fact}`);
  }
});

test("availability and action status remain deterministic in every key style", async () => {
  const styles: NadimLanguageStyle[] = ["AR_EGYPTIAN", "AR_GULF", "AR_FORMAL", "EN_US", "FRANCO_ARABIC", "MIXED_AR_EN"];
  for (const style of styles) {
    const availability = await compose({
      style,
      intent: "AVAILABILITY_QUESTION",
      plan: { goal: "AVAILABILITY_QUESTION", steps: [{ tool: "GET_AVAILABILITY", arguments: { unitId: "unit-1" } }] },
      tools: [{ tool: "GET_AVAILABILITY", ok: true, data: { unitId: "unit-1", externalUnitId: "NC-A", status: "UNAVAILABLE" }, latencyMs: 1 }],
    });
    assert.match(availability.reply, /NC-A/u);
    assert.match(availability.reply, /UNAVAILABLE/u);

    const succeeded = await compose({ style, intent: "VIEWING_REQUEST", executedActions: [{ type: "CREATE_VIEWING_REQUEST", status: "SUCCEEDED", entityId: "lead-1" }] });
    const failed = await compose({ style, intent: "VIEWING_REQUEST", executedActions: [{ type: "CREATE_VIEWING_REQUEST", status: "FAILED", errorCode: "DOWNSTREAM_FAILURE" }] });
    const proposed = await compose({ style, intent: "VIEWING_REQUEST", proposedActions: [{ type: "CREATE_VIEWING_REQUEST", reason: "requested", payload: { unitId: "unit-1" } }] });
    assert.notEqual(succeeded.reply, failed.reply);
    assert.notEqual(succeeded.reply, proposed.reply);
    assert.match(proposed.reply, /(?:لسه|إلى الآن|لم يُؤكد|hasn.t been confirmed|ma et2akadsh|مش confirmed)/iu);
    assert.match(failed.reply, /(?:مش هقول|فما راح أقول|لن أقول|won.t say|mesh ha2ool)/iu);
    assert.doesNotMatch(failed.reply, /^(?:تمام، طلب المعاينة اتسجل|تم تسجيل طلب المعاينة|Your viewing request is recorded|tamam, viewing request etsegel)/iu);
  }
});

test("deterministic reset and search-change acknowledgements stay natural in the active style", async () => {
  const resetEnglish = await compose({ style: "EN_US", intent: "RESET_SEARCH" });
  assert.match(resetEnglish.reply, /fresh search/u);
  const resetFranco = await compose({ style: "FRANCO_ARABIC", intent: "RESET_SEARCH" });
  assert.match(resetFranco.reply, /search gedid/u);
  assert.doesNotMatch(resetFranco.reply, /[\u0600-\u06FF]/u);

  const budget = await compose({
    style: "AR_EGYPTIAN",
    intent: "MODIFY_SEARCH",
    goal: "PROPERTY_SEARCH",
    state: {
      search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: [], budgetMax: 10_000_000, currency: "EGP" },
      lastOperations: [{ operation: "SET", field: "budgetMax", value: 10_000_000 }],
    },
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [{ id: "u1", externalUnitId: "NC-A" }], latencyMs: 1 }],
  });
  assert.match(budget.reply, /10\s*مليون/u);
  assert.doesNotMatch(budget.reply, /(?:خليت الميزانية|10,000,000 EGP|updated|preserved)/iu);

  const location = await compose({
    style: "AR_GULF",
    intent: "MODIFY_SEARCH",
    goal: "PROPERTY_SEARCH",
    state: {
      search: { locations: [], projects: [], developers: [], propertyTypes: [] },
      lastOperations: [{ operation: "REMOVE", field: "locations" }],
    },
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [{ id: "u1", externalUnitId: "NC-A" }], latencyMs: 1 }],
  });
  assert.match(location.reply, /الموقع مفتوح/u);
  assert.doesNotMatch(location.reply, /(?:شلت|أزلت|removed)/iu);
  assert.doesNotMatch(location.reply, /مفيش|عايز|التانية/u);
});

test("no-match, unknown payment, and provider failures are truthful and style-aware", async () => {
  const noMatch = await compose({
    style: "EN_US",
    intent: "PROPERTY_SEARCH",
    goal: "PROPERTY_SEARCH",
    state: { search: { locations: [], projects: [], developers: [], propertyTypes: [], budgetMax: 5_000_000, currency: "EGP" } },
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }],
  });
  assert.match(noMatch.reply, /(?:Nothing (?:suitable|useful)|not seeing a (?:suitable|solid))/u);
  assert.doesNotMatch(noMatch.reply, /(?:exact match|100% match|main blocker|5,000,000 EGP.*(?:blocker|issue|reason))/iu);

  const noSearch = await compose({ style: "AR_EGYPTIAN", intent: "PROPERTY_SEARCH", goal: "PROPERTY_SEARCH" });
  assert.doesNotMatch(noSearch.reply, /(?:ملقتش|مفيش\s+(?:نتائج|وحدات))/u);
  assert.match(noSearch.reply, /لسه ما دورتش/u);

  const unknownPlan = await compose({
    style: "AR_GULF",
    intent: "PAYMENT_PLAN_QUESTION",
    plan: { goal: "PAYMENT_PLAN_QUESTION", steps: [{ tool: "GET_PAYMENT_PLAN", arguments: {} }] },
    tools: [{ tool: "GET_PAYMENT_PLAN", ok: true, data: [], latencyMs: 1 }],
  });
  assert.match(unknownPlan.reply, /ما راح أخمن/u);
  assert.doesNotMatch(unknownPlan.reply, /مفيش|دلوقتي/u);

  const providerFailure = await compose({
    style: "FRANCO_ARABIC",
    intent: "PROPERTY_SEARCH",
    goal: "PROPERTY_SEARCH",
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    tools: [{ tool: "PROPERTY_SEARCH", ok: false, errorCode: "PROVIDER_UNAVAILABLE", latencyMs: 1 }],
  });
  assert.match(providerFailure.reply, /search msh shaghala/u);
  assert.doesNotMatch(providerFailure.reply, /[\u0600-\u06FF]/u);
  assert.doesNotMatch(providerFailure.reply, /mala2etsh/u);
});

test("the response model receives personality, selected style, and verified facts without decision authority", async () => {
  let captured: any;
  let calls = 0;
  const model: any = {
    available: () => true,
    compose: async (input: any) => {
      calls += 1;
      captured = input;
      return { value: "Got it.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 };
    },
  };
  const modelComposer = new ResponseComposerService(model, new ResponseStyleService());
  await modelComposer.compose({
    userMessage: "Thanks",
    understanding: understanding("SMALL_TALK"),
    state: styledState("EN_US"),
    plan: { goal: "SMALL_TALK", steps: [] },
    toolResults: [{ tool: "GET_UNIT_FACTS", ok: true, data: { id: "unit-1", price: 7_400_000 }, latencyMs: 1 }],
    proposedActions: [],
    executedActions: [],
  });
  assert.equal(captured.selectedLanguageStyle.preferredResponseStyle, "EN_US");
  assert.equal(captured.personality.role, "premium real-estate sales advisor");
  assert.deepEqual(captured.verifiedFacts, [{ tool: "GET_UNIT_FACTS", data: { id: "unit-1", price: 7_400_000 } }]);

  const proposed = await modelComposer.compose({
    userMessage: "Book a viewing",
    understanding: understanding("VIEWING_REQUEST"),
    state: styledState("EN_US"),
    plan: { goal: "VIEWING_REQUEST", steps: [] },
    toolResults: [],
    proposedActions: [{ type: "CREATE_VIEWING_REQUEST", reason: "requested", payload: { unitId: "unit-1" } }],
    executedActions: [],
  });
  assert.equal(calls, 2);
  assert.match(proposed.reply, /hasn.t been confirmed/u);
});

test("every deterministic Franco surface remains in readable Latin script", () => {
  const copy = new ResponseStyleService();
  const current = styledState("FRANCO_ARABIC", {
    search: { locations: ["New Cairo"], projects: [], developers: [], propertyTypes: [], budgetMax: 8_000_000, currency: "EGP" },
    lastOperations: [{ operation: "SET", field: "budgetMax", value: 8_000_000 }],
  });
  const unit = { id: "unit-1", externalUnitId: "NC-A", bedrooms: 3, bathrooms: 2, builtUpArea: 155, price: 7_400_000, currency: "EGP", project: { name: "Palm Hills" } };
  const proposal: any = { type: "CREATE_VIEWING_REQUEST", reason: "requested", payload: { unitId: "unit-1" } };
  const surfaces = [
    copy.greeting("FRANCO_ARABIC", true, "hi"),
    copy.greeting("FRANCO_ARABIC", false, "hi"),
    copy.languageChanged("FRANCO_ARABIC"),
    copy.clarification("FRANCO_ARABIC", "RESULT_REFERENCE_NOT_FOUND"),
    copy.clarification("FRANCO_ARABIC", "COMPARISON_SELECTION_REQUIRED"),
    copy.clarification("FRANCO_ARABIC", "UNIT_SELECTION_REQUIRED"),
    copy.clarification("FRANCO_ARABIC", "SEARCH_CHANGE_AMOUNT_REQUIRED"),
    copy.reset("FRANCO_ARABIC"),
    copy.searchNotRun("FRANCO_ARABIC"),
    copy.searchFailed("FRANCO_ARABIC"),
    copy.noMatch("FRANCO_ARABIC"),
    copy.noMatch("FRANCO_ARABIC", {
      previousAssistantWording: copy.noMatch("FRANCO_ARABIC"),
    }),
    copy.searchResults("FRANCO_ARABIC", [unit, { ...unit, id: "unit-2", externalUnitId: "NC-B", price: 7_900_000, builtUpArea: 170 }]),
    copy.comparison("FRANCO_ARABIC", [unit]),
    copy.media("FRANCO_ARABIC", 0, true),
    copy.media("FRANCO_ARABIC", 2, true),
    copy.paymentPlans("FRANCO_ARABIC", [], true),
    copy.paymentPlans("FRANCO_ARABIC", [{ name: "Plan A", downPaymentPercent: 10, durationMonths: 96 }], true),
    copy.price("FRANCO_ARABIC", unit),
    copy.availability("FRANCO_ARABIC", { externalUnitId: "NC-A", status: "AVAILABLE" }),
    copy.unknown("FRANCO_ARABIC"),
    copy.safeFallback("FRANCO_ARABIC"),
    copy.preservedSearch("FRANCO_ARABIC"),
    copy.currentSearch("FRANCO_ARABIC", current, "budgetMax"),
    copy.currentSearch("FRANCO_ARABIC", current, "bedrooms"),
    copy.currentSearch("FRANCO_ARABIC", current, "locations"),
    copy.currentSearch("FRANCO_ARABIC", current, "SEARCH"),
    copy.proposedAction("FRANCO_ARABIC", proposal),
    copy.actionResult("FRANCO_ARABIC", { type: "CREATE_VIEWING_REQUEST", status: "SUCCEEDED" }),
    copy.actionResult("FRANCO_ARABIC", { type: "CREATE_VIEWING_REQUEST", status: "FAILED" }),
    copy.operationSummary("FRANCO_ARABIC", current.lastOperations, current),
  ];
  for (const surface of surfaces) {
    assert.ok(surface);
    assert.doesNotMatch(surface, /[\u0600-\u06FF]/u, surface);
  }
});

test("language-style application remains independent from deterministic state updates", () => {
  const base = detector.apply(styledState("AR_EGYPTIAN"), "عايز شقة في التجمع");
  const next = stateEngine.apply(base, understanding("PROPERTY_SEARCH", [
    { operation: "SET", field: "locations", value: ["التجمع"] },
    { operation: "SET", field: "bedrooms", value: 3 },
  ]), { channel: "WEB" });
  assert.equal(next.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(next.search.locations, ["التجمع"]);
  assert.equal(next.search.bedrooms, 3);
});

async function freshLanguageTurn(message: string, locale = "ar-EG") {
  const initial = initialNadimState({ channel: "WEB", locale });
  const styled = detector.apply(initial, message, locale);
  const parsed = await new UnderstandingService(noModel).understand(message, styled);
  const state = stateEngine.apply(styled, parsed.understanding, { channel: "WEB", locale });
  return { understanding: parsed.understanding, state, plan: planner.plan(parsed.understanding, state) };
}

test("fresh language turns recover search meaning and grammatical address without model dependency", async () => {
  const cases = [
    {
      message: "عايز شقة 3 غرف في التجمع تحت 8 مليون",
      style: "AR_EGYPTIAN",
      address: "MASCULINE",
      expected: { bedrooms: 3, budgetMax: 8_000_000, type: "Apartment", location: "التجمع" },
    },
    {
      message: "عايزة شقة 3 غرف في التجمع",
      style: "AR_EGYPTIAN",
      address: "FEMININE",
      expected: { bedrooms: 3, type: "Apartment", location: "التجمع" },
    },
    {
      message: "أبي شقة 3 غرف في التجمع وودي تكون بالتقسيط",
      style: "AR_GULF",
      address: "NEUTRAL",
      expected: { bedrooms: 3, type: "Apartment", location: "التجمع", installmentPreference: "INSTALLMENTS" },
    },
    {
      message: "I need a 3-bedroom apartment in New Cairo under 8 million EGP",
      style: "EN_US",
      address: "NEUTRAL",
      expected: { bedrooms: 3, budgetMax: 8_000_000, type: "Apartment", location: "new cairo" },
    },
    {
      message: "3ayz sho2a 3 rooms fel tagamo3 ta7t 8 million",
      style: "FRANCO_ARABIC",
      address: "MASCULINE",
      expected: { bedrooms: 3, budgetMax: 8_000_000, type: "Apartment", location: "new cairo" },
    },
    {
      message: "3ayza sho2a 3 rooms fel tagamo3",
      style: "FRANCO_ARABIC",
      address: "FEMININE",
      expected: { bedrooms: 3, type: "Apartment", location: "new cairo" },
    },
    {
      message: "عايز apartment 3 bedrooms في New Cairo تحت 8 million",
      style: "MIXED_AR_EN",
      address: "MASCULINE",
      expected: { bedrooms: 3, budgetMax: 8_000_000, type: "Apartment", location: "new cairo" },
    },
  ] as const;

  for (const item of cases) {
    const locale = item.style === "EN_US" ? "en-US" : item.style === "AR_GULF" ? "ar-SA" : "ar-EG";
    const result = await freshLanguageTurn(item.message, locale);
    assert.equal(result.state.languageStyle.inputLanguage, item.style, item.message);
    const expectedResponse = item.style === "EN_US" ? "EN_US" : item.style === "AR_GULF" ? "AR_GULF" : "AR_EGYPTIAN";
    assert.equal(result.state.languageStyle.preferredResponseStyle, expectedResponse, item.message);
    assert.equal(result.state.languageStyle.grammaticalAddress, item.address, item.message);
    assert.equal(result.understanding.intent, "PROPERTY_SEARCH", item.message);
    assert.equal(result.plan.steps[0]?.tool, "PROPERTY_SEARCH", item.message);
    assert.equal(result.state.search.bedrooms, item.expected.bedrooms, item.message);
    assert.equal(result.state.search.propertyTypes[0], item.expected.type, item.message);
    assert.ok(result.state.search.locations.some((location) => location.toLowerCase() === item.expected.location), item.message);
    if ("budgetMax" in item.expected) assert.equal(result.state.search.budgetMax, item.expected.budgetMax, item.message);
    if ("installmentPreference" in item.expected) assert.equal(result.state.search.installmentPreference, item.expected.installmentPreference, item.message);
  }
});

test("grammatical address is linguistic-only, explicit preferences win, and conflicts become neutral", async () => {
  const feminine = detector.apply(initialNadimState({ channel: "WEB", locale: "ar-EG" }), "عايزة شقة في التجمع");
  assert.equal(feminine.languageStyle.grammaticalAddress, "FEMININE");
  assert.equal(feminine.languageStyle.grammaticalAddressExplicit, false);

  const explicit = detector.apply(feminine, "خليني أكمل من غير صيغة مؤنث");
  assert.equal(explicit.languageStyle.grammaticalAddress, "MASCULINE");
  assert.equal(explicit.languageStyle.grammaticalAddressExplicit, true);
  const laterMarker = detector.apply(explicit, "عايزة أعرف السعر");
  assert.equal(laterMarker.languageStyle.grammaticalAddress, "MASCULINE");

  const conflict = detector.detect("عايزة شقة وأنا حابب أشوف المتاح");
  assert.equal(conflict.grammaticalAddress, "NEUTRAL");

  const feminineState = styledState("AR_EGYPTIAN");
  feminineState.languageStyle.grammaticalAddress = "FEMININE";
  const feminineReply = await composer.compose({
    userMessage: "عايزة اختيارات",
    understanding: understanding("PROPERTY_SEARCH"),
    state: feminineState,
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] },
    toolResults: [{ tool: "PROPERTY_SEARCH", ok: true, data: [{ id: "u1" }, { id: "u2" }], latencyMs: 1 }],
    proposedActions: [],
    executedActions: [],
  });
  assert.match(feminineReply.reply, /لو حابة/u);
});

test("language and address switching preserve search, selection, and result continuity", async () => {
  const first = await freshLanguageTurn("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  const seeded = { ...first.state, selectedUnitId: "unit-1", lastResultIds: ["unit-1", "unit-2"], comparisonUnitIds: ["unit-1", "unit-2"] };
  const original = structuredClone(seeded.search);

  const englishStyled = detector.apply(seeded, "Explain the options in English");
  const stateChangingModel: any = {
    available: () => true,
    understand: async () => ({
      value: {
        understood: true, understoodMeaning: "Explain the existing options in English.", responseGoal: "EXPLAIN_CURRENT_OPTIONS",
        conversationalType: "STRUCTURED_REQUEST", proposedIntent: "MODIFY_SEARCH",
        proposedStateOperations: [{ operation: "RESET", field: "SEARCH" }], references: [], toolNeed: { required: true, kind: "PROPERTY_SEARCH" },
        clarification: { required: false }, confidence: 1, ordinalReferences: [], recentContextUsed: true,
      },
      provider: "test", model: "test", fallbackUsed: false, latencyMs: 1,
    }),
  };
  const englishUnderstanding = await new UnderstandingService(stateChangingModel).understand("Explain the options in English", englishStyled);
  const english = stateEngine.apply(englishStyled, englishUnderstanding.understanding, { channel: "WEB" });
  assert.equal(english.languageStyle.preferredResponseStyle, "EN_US");
  assert.deepEqual(englishUnderstanding.understanding.operations, []);
  assert.deepEqual(english.search, original);
  assert.deepEqual(english.lastResultIds, seeded.lastResultIds);
  assert.equal(english.selectedUnitId, "unit-1");

  const egyptianStyled = detector.apply(english, "كمل مصري");
  const egyptianUnderstanding = await new UnderstandingService(noModel).understand("كمل مصري", egyptianStyled);
  const egyptian = stateEngine.apply(egyptianStyled, egyptianUnderstanding.understanding, { channel: "WEB" });
  assert.equal(egyptian.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(egyptian.search, original);
  assert.deepEqual(egyptian.comparisonUnitIds, seeded.comparisonUnitIds);
});

test("gibberish cannot replay an active search or accept model-authored state changes", async () => {
  const active = styledState("AR_EGYPTIAN", {
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
    lastResultIds: ["unit-1"],
  });
  const adversarialModel: any = {
    available: () => true,
    understand: async () => ({
      value: {
        understood: true, understoodMeaning: "Search for properties.", responseGoal: "SEARCH_VERIFIED_INVENTORY",
        conversationalType: "STRUCTURED_REQUEST", proposedIntent: "PROPERTY_SEARCH",
        proposedStateOperations: [{ operation: "RESET", field: "SEARCH" }], references: [], toolNeed: { required: true, kind: "PROPERTY_SEARCH" },
        clarification: { required: false }, confidence: 1, ordinalReferences: [], recentContextUsed: false,
      },
      provider: "test", model: "test", fallbackUsed: false, latencyMs: 1,
    }),
  };
  const parsed = await new UnderstandingService(adversarialModel).understand("svgsvg", active);
  const next = stateEngine.apply(active, parsed.understanding, { channel: "WEB" });
  const plan = planner.plan(parsed.understanding, next);
  assert.equal(parsed.understanding.intent, "UNKNOWN");
  assert.deepEqual(parsed.understanding.operations, []);
  assert.deepEqual(next.search, active.search);
  assert.deepEqual(next.lastResultIds, active.lastResultIds);
  assert.equal(plan.steps.length, 0);

  const response = await composer.compose({
    userMessage: "svgsvg",
    understanding: parsed.understanding,
    state: next,
    plan,
    toolResults: [],
    proposedActions: [],
    executedActions: [],
  });
  assert.match(response.reply, /مش فاهم قصدك/u);
  assert.doesNotMatch(response.reply, /(?:مش ظاهر|ملقتش|مفيش (?:اختيار|نتائج|وحدات))/u);
});

test("verified no-match wording stays natural, cause-free, and context-aware", async () => {
  const baseInput = {
    userMessage: "عايز شقة 3 غرف في التجمع تحت 8 مليون",
    understanding: understanding("PROPERTY_SEARCH"),
    plan: { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: {} }] } as NadimPlan,
    toolResults: [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }] as NadimToolResult[],
    proposedActions: [],
    executedActions: [],
  };
  const first = await composer.compose({ ...baseInput, state: styledState("AR_EGYPTIAN", { search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 } }) });
  const second = await composer.compose({ ...baseInput, state: styledState("AR_EGYPTIAN", { search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 }, recentAssistantWording: first.reply }) });
  assert.notEqual(first.reply, second.reply);
  for (const reply of [first.reply, second.reply]) {
    assert.match(reply, /(?:مش شايف|مفيش حاجة)/u);
    assert.doesNotMatch(reply, /(?:مطابقة 100%|القيد|المعايير المحددة|الشروط المحددة|الميزانية.{0,20}(?:السبب|مقلل|مانع))/u);
    assert.doesNotMatch(reply, /(?:نزود الميزانية|نغيّر المواصفات|نوسّع|تحب|ممكن نجرب)/u);
  }

  let captured: any;
  const naturalModel: any = {
    available: () => true,
    compose: async (input: any) => {
      captured = input;
      return { value: "Nothing useful is showing up right now.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 };
    },
  };
  const modelComposer = new ResponseComposerService(naturalModel, new ResponseStyleService());
  const modelState = styledState("EN_US", { recentAssistantWording: "Nothing suitable showed up before." });
  const previousTurn = { userMessage: "Keep the same setup", assistantReply: "Nothing suitable showed up before." };
  const modeled = await modelComposer.compose({ ...baseInput, state: modelState, previousTurn });
  assert.match(modeled.reply, /Nothing useful/u);
  assert.equal(captured.responseGoal, "VERIFIED_EMPTY_SEARCH");
  assert.equal(captured.previousAssistantWording, modelState.recentAssistantWording);
  assert.deepEqual(captured.previousTurnSummary, { user: previousTurn.userMessage, assistant: previousTurn.assistantReply });
  assert.deepEqual(captured.searchExecution, { executed: true, succeeded: true, verifiedResultCount: 0 });
  assert.deepEqual(captured.currentStateOperations, []);

  const causalModel: any = {
    available: () => true,
    compose: async () => ({ value: "Nothing suitable is showing because the budget is too low.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }),
  };
  const guarded = await new ResponseComposerService(causalModel, new ResponseStyleService()).compose({ ...baseInput, state: styledState("EN_US") });
  assert.doesNotMatch(guarded.reply, /budget is too low/u);

  const inventedInventoryModel: any = {
    available: () => true,
    compose: async () => ({ value: "Nothing suitable is showing, but unit NC-X is available for 7 million EGP.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }),
  };
  const inventoryGuarded = await new ResponseComposerService(inventedInventoryModel, new ResponseStyleService()).compose({ ...baseInput, state: styledState("EN_US") });
  assert.doesNotMatch(inventoryGuarded.reply, /(?:NC-X|7 million EGP)/u);

  const wrongStyleModel: any = {
    available: () => true,
    compose: async () => ({ value: "Nothing suitable is showing right now.", provider: "test", model: "test", fallbackUsed: false, latencyMs: 1 }),
  };
  const francoGuarded = await new ResponseComposerService(wrongStyleModel, new ResponseStyleService()).compose({ ...baseInput, state: styledState("FRANCO_ARABIC") });
  assert.match(francoGuarded.reply, /(?:Msh|msh|Delwa2ty)/u);
  assert.doesNotMatch(francoGuarded.reply, /Nothing suitable/u);
});

test("language-only turns cannot narrate a stale budget operation", async () => {
  const state = styledState("EN_US", {
    search: { locations: ["New Cairo"], projects: [], developers: [], propertyTypes: ["Apartment"], budgetMax: 10_000_000 },
    lastOperations: [],
  });
  state.languageStyle.changedThisTurn = true;
  const reply = await composer.compose({
    userMessage: "Explain the search in English",
    understanding: understanding("SMALL_TALK"),
    state,
    plan: { goal: "SMALL_TALK", steps: [] },
    toolResults: [],
    proposedActions: [],
    executedActions: [],
  });
  assert.doesNotMatch(reply.reply, /(?:updated|budget is now|10,000,000)/iu);
});

test("the observed seven-turn Egyptian conversation stays human, brief, and state-grounded", async () => {
  const understander = new UnderstandingService(noModel);
  let current = initialNadimState({ channel: "WEB", locale: "ar-EG" });
  const run = async (message: string) => {
    const styled = detector.apply(current, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    let next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    const plan = planner.plan(parsed, next);
    const toolResults: NadimToolResult[] = plan.steps.some((step) => step.tool === "PROPERTY_SEARCH")
      ? [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }]
      : [];
    const composed = await composer.compose({ userMessage: message, understanding: parsed, state: next, plan, toolResults, proposedActions: [], executedActions: [] });
    next = stateEngine.withAssistantWording(next, composed.reply);
    current = next;
    return { parsed, state: next, plan, reply: composed.reply };
  };

  const search = await run("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  assert.match(search.reply, /(?:مش شايف|مفيش حاجة)/u);
  assert.doesNotMatch(search.reply, /(?:مطابقة 100%|الشروط|المعايير|نوسّع|تحب)/u);

  const budgetChange = await run("خليها 10 مليون");
  assert.equal(budgetChange.state.search.budgetMax, 10_000_000);
  assert.match(budgetChange.reply, /10\s*مليون/u);
  assert.doesNotMatch(budgetChange.reply, /(?:خليت الميزانية|10,000,000 EGP|updated|preserved)/iu);

  const budgetQuery = await run("الميزانية اللي محددها كام؟");
  assert.deepEqual(budgetQuery.plan.steps, []);
  assert.match(budgetQuery.reply, /10\s*مليون/u);
  assert.ok(budgetQuery.reply.length < 45, budgetQuery.reply);
  assert.doesNotMatch(budgetQuery.reply, /(?:نوسّع|نغيّر|تحب|ممكن|\?)/u);

  const removeLocation = await run("مش مهم التجمع");
  assert.deepEqual(removeLocation.state.search.locations, []);
  assert.match(removeLocation.reply, /المكان مفتوح/u);
  assert.doesNotMatch(removeLocation.reply, /(?:شلت المكان|أزلت الموقع|removed the location)/iu);

  const summary = await run("المواصفات اللي بندور عليها إيه؟");
  assert.deepEqual(summary.plan.steps, []);
  assert.match(summary.reply, /شقة/u);
  assert.match(summary.reply, /3\s*غرف/u);
  assert.match(summary.reply, /10\s*مليون/u);
  assert.match(summary.reply, /المكان مفتوح/u);
  assert.doesNotMatch(summary.reply, /(?:Apartment|10,000,000 EGP|Location:\s*none|·)/iu);

  const rejection = await run("لا توسع الخيارات");
  assert.deepEqual(rejection.plan.steps, []);
  assert.ok(rejection.reply.length < 55, rejection.reply);
  assert.doesNotMatch(rejection.reply, /(?:نوسّع|نغيّر|تحب|ممكن|\?)/u);

  const unknown = await run("svgsvg");
  assert.equal(unknown.parsed.intent, "UNKNOWN");
  assert.equal(unknown.state.languageStyle.detected, "UNKNOWN");
  assert.equal(unknown.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(unknown.plan.steps, []);
  assert.match(unknown.reply, /[\u0600-\u06FF]/u);
  assert.doesNotMatch(unknown.reply, /(?:I didn.t catch|What did you mean|مش شايف|مفيش حاجة)/iu);
});

test("input language stays independent from the sticky response language until an explicit switch", async () => {
  const understander = new UnderstandingService(noModel);
  let current = initialNadimState({ channel: "WEB", locale: "ar-EG" });
  current = {
    ...current,
    revision: 3,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
    lastResultIds: ["unit-1", "unit-2"],
  };
  const originalSearch = structuredClone(current.search);

  const run = async (message: string, facts: any[] = []) => {
    const styled = detector.apply(current, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    const next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    const plan = planner.plan(parsed, next);
    const toolResults: NadimToolResult[] = plan.steps.map((step) => ({
      tool: step.tool,
      ok: true,
      data: step.tool === "PROPERTY_SEARCH" ? [] : facts,
      latencyMs: 1,
    }));
    const response = await composer.compose({ userMessage: message, understanding: parsed, state: next, plan, toolResults, proposedActions: [], executedActions: [] });
    current = stateEngine.withAssistantWording(next, response.reply);
    return { styled, parsed, state: current, plan, reply: response.reply };
  };

  const identity = await run("What's your name?");
  assert.equal(identity.parsed.intent, "ASSISTANT_IDENTITY");
  assert.equal(identity.state.languageStyle.inputLanguage, "EN_US");
  assert.equal(identity.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.equal(identity.state.locale, "ar-EG");
  assert.deepEqual(identity.plan.steps, []);
  assert.match(identity.reply, /نديم/u);
  assert.doesNotMatch(identity.reply, /I(?:’|'| a)m Nadim/iu);

  const modification = await run("Make it 10 million");
  assert.equal(modification.parsed.intent, "MODIFY_SEARCH");
  assert.equal(modification.state.search.budgetMax, 10_000_000);
  assert.equal(modification.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.match(modification.reply, /10\s*مليون/u);
  assert.deepEqual({ ...modification.state.search, budgetMax: originalSearch.budgetMax }, originalSearch);

  current = { ...current, lastResultIds: ["unit-1", "unit-2"] };
  const selected = await run("Show me the second one", [{ id: "unit-2", price: 7_500_000, currency: "EGP" }]);
  assert.equal(selected.parsed.intent, "PROPERTY_QUESTION");
  assert.equal(selected.state.selectedUnitId, "unit-2");
  assert.equal(selected.plan.steps[0]?.tool, "GET_UNIT_FACTS");
  assert.equal(selected.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");

  const switched = await run("Reply in English");
  assert.equal(switched.state.languageStyle.preferredResponseStyle, "EN_US");
  assert.equal(switched.state.languageStyle.explicitOverride, true);
  assert.equal(switched.state.languageStyle.explicitRequestThisTurn, true);
  assert.deepEqual(switched.plan.steps, []);
  assert.equal(switched.state.selectedUnitId, "unit-2");
  assert.deepEqual(switched.state.lastResultIds, ["unit-1", "unit-2"]);
  assert.match(switched.reply, /English/iu);

  const budget = await run("What's my budget?");
  assert.equal(budget.parsed.intent, "CURRENT_SEARCH_QUERY");
  assert.deepEqual(budget.plan.steps, []);
  assert.match(budget.reply, /10\s*M|10\s*million/iu);
  assert.doesNotMatch(budget.reply, /[\u0600-\u06FF]/u);

  const back = await run("كمل مصري");
  assert.equal(back.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(back.plan.steps, []);
  assert.equal(back.state.search.budgetMax, 10_000_000);

  const unknown = await run("svgsvg");
  assert.equal(unknown.parsed.intent, "UNKNOWN");
  assert.equal(unknown.state.languageStyle.inputLanguage, "UNKNOWN");
  assert.equal(unknown.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.match(unknown.reply, /[\u0600-\u06FF]/u);
  assert.deepEqual(unknown.plan.steps, []);
});

test("customer-service intents gate inventory and reset only the requested search state", async () => {
  const understander = new UnderstandingService(noModel);
  const active = styledState("AR_EGYPTIAN", {
    revision: 5,
    customerId: "customer-1",
    externalUserId: "web-user-1",
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 10_000_000 },
    selectedUnitId: "unit-2",
    lastResultIds: ["unit-1", "unit-2"],
  });

  for (const [message, expectedIntent] of [
    ["اسمك اي", "ASSISTANT_IDENTITY"],
    ["What's your name?", "ASSISTANT_IDENTITY"],
    ["شكرا", "SMALL_TALK"],
    ["كلمني بكرة", "CALLBACK_REQUEST"],
    ["عايز أكلم حد", "HUMAN_HANDOFF"],
    ["الميزانية اللي محددها كام؟", "CURRENT_SEARCH_QUERY"],
  ] as const) {
    const styled = detector.apply(active, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    const next = stateEngine.apply(styled, parsed, { channel: "WEB", customerId: active.customerId, externalUserId: active.externalUserId });
    const plan = planner.plan(parsed, next);
    assert.equal(parsed.intent, expectedIntent, message);
    assert.equal(plan.steps.some((step) => step.tool === "PROPERTY_SEARCH"), false, message);
    assert.deepEqual(next.search, active.search, message);
  }

  for (const message of [
    "عايز شقة 3 غرف في التجمع",
    "وريني المتاح",
    "فيه حاجة في زايد تحت 10 مليون؟",
    "دورلي على فيلا",
  ]) {
    const fresh = initialNadimState({ channel: "WEB", locale: "ar-EG" });
    const styled = detector.apply(fresh, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    const next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    assert.equal(parsed.intent, "PROPERTY_SEARCH", message);
    assert.equal(planner.plan(parsed, next).steps[0]?.tool, "PROPERTY_SEARCH", message);
  }

  const resetUnderstanding = (await understander.understand("ابدأ من الأول", detector.apply(active, "ابدأ من الأول"))).understanding;
  const reset = stateEngine.apply(active, resetUnderstanding, { channel: "WEB", customerId: active.customerId, externalUserId: active.externalUserId });
  assert.equal(resetUnderstanding.intent, "RESET_SEARCH");
  assert.deepEqual(resetUnderstanding.ordinalReferences, []);
  assert.deepEqual(reset.search, { locations: [], projects: [], developers: [], propertyTypes: [] });
  assert.equal(reset.customerId, "customer-1");
  assert.equal(reset.externalUserId, "web-user-1");
  assert.equal(reset.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.deepEqual(planner.plan(resetUnderstanding, reset).steps, []);

  const broadMessage = "ابدأ من الأول وامشي أي حاجة";
  const broadUnderstanding = (await understander.understand(broadMessage, detector.apply(active, broadMessage))).understanding;
  const broad = stateEngine.apply(active, broadUnderstanding, { channel: "WEB", customerId: active.customerId, externalUserId: active.externalUserId });
  const broadPlan = planner.plan(broadUnderstanding, broad);
  assert.equal(broadUnderstanding.intent, "PROPERTY_SEARCH");
  assert.deepEqual(broadUnderstanding.ordinalReferences, []);
  assert.deepEqual(broad.search, { locations: [], projects: [], developers: [], propertyTypes: [] });
  assert.equal(broad.pendingClarification, undefined);
  assert.equal(broadPlan.steps[0]?.tool, "PROPERTY_SEARCH");
});

test("final response-language regression sequence preserves state except explicit budget and style changes", async () => {
  const understander = new UnderstandingService(noModel);
  let current = initialNadimState({ channel: "WEB", customerId: "customer-1", externalUserId: "web-user-1", locale: "ar-EG" });
  const outputs: string[] = [];
  const run = async (message: string) => {
    const styled = detector.apply(current, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    let next = stateEngine.apply(styled, parsed, { channel: "WEB", customerId: current.customerId, externalUserId: current.externalUserId });
    const plan = planner.plan(parsed, next);
    const toolResults: NadimToolResult[] = plan.steps.some((step) => step.tool === "PROPERTY_SEARCH")
      ? [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }]
      : [];
    const response = await composer.compose({ userMessage: message, understanding: parsed, state: next, plan, toolResults, proposedActions: [], executedActions: [] });
    next = stateEngine.withAssistantWording(next, response.reply);
    current = next;
    outputs.push(response.reply);
    return { parsed, plan, reply: response.reply };
  };

  await run("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  const budgetArabic = await run("What's my budget?");
  await run("Make it 10 million");
  const identityArabic = await run("What's your name?");
  await run("Reply in English");
  const budgetEnglish = await run("What's my budget?");
  await run("كمل مصري");
  const identityEgyptian = await run("اسمك اي");

  assert.match(budgetArabic.reply, /8\s*مليون/u);
  assert.match(identityArabic.reply, /نديم/u);
  assert.match(budgetEnglish.reply, /10\s*M|10\s*million/iu);
  assert.match(identityEgyptian.reply, /نديم/u);
  assert.equal(current.search.budgetMax, 10_000_000);
  assert.equal(current.search.bedrooms, 3);
  assert.deepEqual(current.search.locations, ["التجمع"]);
  assert.deepEqual(current.search.propertyTypes, ["Apartment"]);
  assert.equal(current.customerId, "customer-1");
  assert.equal(current.externalUserId, "web-user-1");
  assert.equal(current.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.equal(outputs.length, 8);
  for (const item of [budgetArabic, identityArabic, budgetEnglish, identityEgyptian]) assert.deepEqual(item.plan.steps, []);
});

test("language capability questions never switch style while explicit labels do and Arabic restores the prior dialect", async () => {
  const understander = new UnderstandingService(noModel);
  let current = initialNadimState({ channel: "WEB", locale: "ar-EG" });
  current = {
    ...current,
    revision: 2,
    search: { locations: ["التجمع"], projects: [], developers: [], propertyTypes: ["Apartment"], bedrooms: 3, budgetMax: 8_000_000 },
  };
  const originalSearch = structuredClone(current.search);

  const run = async (message: string) => {
    const styled = detector.apply(current, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    const next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    const plan = planner.plan(parsed, next);
    const response = await composer.compose({ userMessage: message, understanding: parsed, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });
    current = stateEngine.withAssistantWording(next, response.reply);
    return { parsed, state: current, plan, reply: response.reply };
  };

  for (const message of ["بتتكلم انجليزي", "بتعرف تتكلم سعودي؟", "تعرف خليجي؟", "Can you speak Arabic?", "Do you speak English?"]) {
    const result = await run(message);
    assert.equal(result.parsed.intent, "LANGUAGE_CAPABILITY_QUERY", message);
    assert.equal(result.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN", message);
    assert.equal(result.state.languageStyle.explicitRequestThisTurn, false, message);
    assert.deepEqual(result.plan.steps, [], message);
    assert.deepEqual(result.state.search, originalSearch, message);
    assert.match(result.reply, /[\u0600-\u06FF]/u, message);
  }

  const english = await run("رد انجليزي");
  assert.equal(english.parsed.intent, "LANGUAGE_STYLE_CHANGE");
  assert.equal(english.state.languageStyle.preferredResponseStyle, "EN_US");
  assert.equal(english.state.languageStyle.lastArabicResponseStyle, "AR_EGYPTIAN");

  const restored = await run("رد عربي");
  assert.equal(restored.parsed.intent, "LANGUAGE_STYLE_CHANGE");
  assert.equal(restored.state.languageStyle.preferredResponseStyle, "AR_EGYPTIAN");
  assert.doesNotMatch(restored.reply, /سأتابع|بالتأكيد/u);

  for (const [message, style, regionalVariant] of [
    ["مصري", "AR_EGYPTIAN", undefined],
    ["خليجي", "AR_GULF", undefined],
    ["سعودي", "AR_GULF", "SAUDI"],
    ["English", "EN_US", undefined],
    ["عربي", "AR_GULF", "SAUDI"],
  ] as const) {
    const result = await run(message);
    assert.equal(result.parsed.intent, "LANGUAGE_STYLE_CHANGE", message);
    assert.equal(result.state.languageStyle.preferredResponseStyle, style, message);
    assert.equal(result.state.languageStyle.regionalVariant, regionalVariant, message);
    assert.deepEqual(result.plan.steps, [], message);
    assert.deepEqual(result.state.search, originalSearch, message);
  }

  const saudi = await run("رد سعودي");
  assert.equal(saudi.state.languageStyle.regionalVariant, "SAUDI");
  await run("Answer in English");
  const restoredSaudi = await run("رد عربي");
  assert.equal(restoredSaudi.state.languageStyle.preferredResponseStyle, "AR_GULF");
  assert.equal(restoredSaudi.state.languageStyle.regionalVariant, "SAUDI");
});

test("ordinary customer-service conversation is understood without inventory or state mutation", async () => {
  const understander = new UnderstandingService(noModel);
  const active = initialNadimState({ channel: "WEB", locale: "ar-AE" });
  active.revision = 4;
  active.search = { locations: ["زايد"], projects: [], developers: [], propertyTypes: ["Villa"], budgetMax: 12_000_000 };
  const originalSearch = structuredClone(active.search);

  const cases: Array<{ message: string; intent: NadimUnderstanding["intent"]; semantic: RegExp }> = [
    { message: "كيفك", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "عامل ايه", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "اخبارك", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "شلونك", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "كيف الحال", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "how are you?", intent: "SMALL_TALK", semantic: /(?:بخير|الحمد لله|حالك)/u },
    { message: "انت تقدر تساعدني ب اي", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "تقدر تعمل اي", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "ممكن تساعدني ازاي", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "كيف أن تساعدني", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "كيف تقدر تساعدني", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "وش تقدر تسوي", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
    { message: "what can you help me with?", intent: "ASSISTANT_CAPABILITIES", semantic: /(?:العقار|العقاري|المتاح|أبحث|أقارن)/u },
  ];

  for (const item of cases) {
    const styled = detector.apply(active, item.message);
    const parsed = (await understander.understand(item.message, styled)).understanding;
    const next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    const plan = planner.plan(parsed, next);
    const response = await composer.compose({ userMessage: item.message, understanding: parsed, state: next, plan, toolResults: [], proposedActions: [], executedActions: [] });
    assert.equal(parsed.intent, item.intent, item.message);
    assert.notEqual(parsed.intent, "UNKNOWN", item.message);
    assert.equal(next.languageStyle.preferredResponseStyle, "AR_GULF", item.message);
    assert.deepEqual(plan.steps, [], item.message);
    assert.deepEqual(next.search, originalSearch, item.message);
    assert.match(response.reply, item.semantic, item.message);
    assert.doesNotMatch(response.reply, /(?:ما فهمت|لم أفهم|I didn.t catch)/iu, item.message);
  }
});

test("observed conversational regression sequence remains customer-service-first", async () => {
  const understander = new UnderstandingService(noModel);
  let current = initialNadimState({ channel: "WEB", locale: "ar-EG" });
  const outputs: Array<{ message: string; intent: NadimUnderstanding["intent"]; style: NadimLanguageStyle; regionalVariant?: string; tools: string[]; reply: string }> = [];
  const run = async (message: string) => {
    const styled = detector.apply(current, message);
    const parsed = (await understander.understand(message, styled)).understanding;
    let next = stateEngine.apply(styled, parsed, { channel: "WEB" });
    const plan = planner.plan(parsed, next);
    const toolResults: NadimToolResult[] = plan.steps.some((step) => step.tool === "PROPERTY_SEARCH")
      ? [{ tool: "PROPERTY_SEARCH", ok: true, data: [], latencyMs: 1 }]
      : [];
    const response = await composer.compose({ userMessage: message, understanding: parsed, state: next, plan, toolResults, proposedActions: [], executedActions: [] });
    next = stateEngine.withAssistantWording(next, response.reply);
    current = next;
    const result = { message, intent: parsed.intent, style: current.languageStyle.preferredResponseStyle, regionalVariant: current.languageStyle.regionalVariant, tools: plan.steps.map((step) => step.tool), reply: response.reply };
    outputs.push(result);
    return result;
  };

  const unknown = await run("...");
  assert.equal(unknown.intent, "UNKNOWN");
  assert.deepEqual(unknown.tools, []);

  const search = await run("عايز شقة 3 غرف في التجمع تحت 8 مليون");
  assert.equal(search.intent, "PROPERTY_SEARCH");
  assert.deepEqual(search.tools, ["PROPERTY_SEARCH"]);

  const capability = await run("بتتكلم انجليزي");
  assert.equal(capability.intent, "LANGUAGE_CAPABILITY_QUERY");
  assert.equal(capability.style, "AR_EGYPTIAN");
  assert.deepEqual(capability.tools, []);

  assert.equal((await run("رد انجليزي")).style, "EN_US");
  assert.equal((await run("رد عربي")).style, "AR_EGYPTIAN");
  assert.equal((await run("مصري")).style, "AR_EGYPTIAN");
  assert.equal((await run("رد مصري")).style, "AR_EGYPTIAN");

  const saudi = await run("رد سعودي");
  assert.equal(saudi.style, "AR_GULF");
  assert.equal(saudi.regionalVariant, "SAUDI");
  assert.equal((await run("رد بالسعودية")).regionalVariant, "SAUDI");

  const gulf = await run("رد خليجي");
  assert.equal(gulf.style, "AR_GULF");
  assert.equal(gulf.regionalVariant, undefined);

  for (const [message, expectedIntent] of [
    ["كيفك", "SMALL_TALK"],
    ["مساء الخير", "GREETING"],
    ["كيف أن تساعدني", "ASSISTANT_CAPABILITIES"],
    ["انت تقدر تساعدني ب اي", "ASSISTANT_CAPABILITIES"],
  ] as const) {
    const result = await run(message);
    assert.equal(result.intent, expectedIntent, message);
    assert.equal(result.style, "AR_GULF", message);
    assert.deepEqual(result.tools, [], message);
    assert.doesNotMatch(result.reply, /(?:ما فهمت|لم أفهم|I didn.t catch)/iu, message);
  }

  assert.equal(current.search.budgetMax, 8_000_000);
  assert.equal(current.search.bedrooms, 3);
  assert.deepEqual(current.search.locations, ["التجمع"]);
  assert.equal(outputs.filter((item) => item.tools.includes("PROPERTY_SEARCH")).length, 1);
});
