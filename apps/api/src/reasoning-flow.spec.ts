import * as assert from "node:assert/strict";
import { test } from "node:test";
import { DeterministicAnswerService, ConversationFormatterService, PaymentPresenterService, PropertyPresenterService } from "./conversation";
import { applyDeterministicTurnSemantics, planCustomerTurn, presentationAfterPropertySearch, suggestedUnitIdsAfterTurn } from "./customer-turn-planner";
import { PropertySearchService } from "./property-search.service";
import { StructuredIntent } from "./providers/ai-provider";
import { deterministicIntent } from "./providers/deterministic-intent";
import { normalizeRealEstateSemantics } from "./providers/real-estate-semantics";
import { ChatService } from "./chat.service";

function processTurn(previous: StructuredIntent, source: string, extracted?: StructuredIntent) {
  const plan = planCustomerTurn(source, previous);
  const intent = normalizeRealEstateSemantics(source, extracted ?? deterministicIntent([{ role: "user", content: source }], previous), previous);
  return applyDeterministicTurnSemantics(source, intent, previous, plan);
}

function unit(id: string, price: number, unitType: string) {
  return {
    id, externalUnitId: id.toUpperCase(), price, currency: "EGP", unitType,
    status: "AVAILABLE", projectId: "p1", availabilityUpdatedAt: new Date(),
    project: { nameAr: "مشروع موثق", locationId: null, location: { nameAr: "التجمع" }, gates: [], amenities: [], investmentProfile: null },
    developer: { nameAr: "مطور موثق" }, paymentPlans: [], offers: [], media: [], proximities: [],
  };
}

test("scenario A preserves, removes, globally ranks, then answers the returned unit type", async () => {
  let state: StructuredIntent = { language: "ar-EG", propertyTypes: ["Clinic"], locations: ["القاهرة"] };
  state = processTurn(state, "عاوز وحدة في حدود 3-5 م", { language: "ar-EG" });
  assert.equal(state.budgetMin, 3_000_000);
  assert.equal(state.budgetMax, 5_000_000);
  state = processTurn(state, "مش حابب اغير البادجيت", { ...state, budgetMax: 9_000_000 });
  assert.equal(state.budgetMax, 5_000_000);
  state = processTurn(state, "شيل النوع ووسع المنطقة");
  assert.equal(state.propertyTypes, undefined);
  assert.equal(state.locations, undefined);
  assert.equal(state.budgetMax, 5_000_000);
  state = processTurn(state, "الغي شرط ال 5 م");
  assert.equal(state.budgetMin, undefined);
  assert.equal(state.budgetMax, undefined);
  assert.equal(state.currency, undefined);
  state = processTurn(state, "ارخص وحدة عندك نوعها اي");
  assert.equal(state.queryObjective, "CHEAPEST");
  assert.equal(state.propertyTypes, undefined, "the question does not create or remove a type preference");

  let databaseQuery: any;
  const inventory = [unit("u-expensive", 11_000_000, "Villa"), unit("u-cheapest", 6_000_000, "Apartment")];
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (query: any) => { databaseQuery = query; return [...inventory].sort((a, b) => a.price - b.price); } },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  const results = await new PropertySearchService(prisma as any).searchProperties(state);
  assert.deepEqual(databaseQuery.orderBy[0], { price: { sort: "asc", nulls: "last" } });
  assert.equal(results[0].id, "u-cheapest");

  const formatter = new ConversationFormatterService();
  const presenter = new PropertyPresenterService(formatter);
  const answers = new DeterministicAnswerService(formatter, presenter, new PaymentPresenterService(formatter));
  const answer = answers.directToolAnswer(state, { type: "text", uiActions: [] }, results, undefined, "PROPERTY_SEARCH", results.length) ?? "";
  assert.match(answer, /Apartment/u);
  assert.match(answer, /6,000,000 EGP/u);
  assert.doesNotMatch(answer, /Villa/u);
});

test("scenario B removes type but preserves the explicit budget", () => {
  let state: StructuredIntent = { language: "ar-EG" };
  state = processTurn(state, "عاوز شقة في حدود 5 مليون", { language: "ar-EG" });
  const budget = state.budgetMax;
  assert.deepEqual(state.propertyTypes, ["Apartment"]);
  state = processTurn(state, "مش فارق النوع");
  assert.equal(state.propertyTypes, undefined);
  assert.equal(state.budgetMax, budget);
});

test("scenario C treats type wording as a contextual detail question", () => {
  const previous: StructuredIntent = { language: "ar-EG", propertyTypes: ["Apartment"], presentation: { searchCandidateIds: ["u1"], lastPresentedUnitIds: ["u1"] } };
  const plan = planCustomerTurn("نوعها اي؟", previous);
  const state = processTurn(previous, "نوعها اي؟", { ...previous, propertyTypes: ["Villa"] });
  assert.equal(plan.intent, "PROPERTY_DETAILS");
  assert.deepEqual(state.propertyTypes, ["Apartment"]);
});

test("scenario D clears successful-search candidates after a zero-result replacement", () => {
  const previous = { searchCandidateIds: ["u1", "u2"], selectedUnitId: "u1", lastPresentedUnitIds: ["u1"], presentedUnitIds: ["u1"] };
  const presentation = presentationAfterPropertySearch(previous, [], undefined, false);
  assert.deepEqual(presentation.searchCandidateIds, []);
  assert.deepEqual(presentation.lastPresentedUnitIds, []);
  assert.equal(presentation.selectedUnitId, undefined);
  assert.deepEqual(suggestedUnitIdsAfterTurn([], true), []);
  const formatter = new ConversationFormatterService();
  const answers = new DeterministicAnswerService(formatter, new PropertyPresenterService(formatter), new PaymentPresenterService(formatter));
  assert.deepEqual(answers.contextualUnitIds({ language: "ar-EG", presentation }, []), []);
  const replaced = presentationAfterPropertySearch(previous, ["u3"], undefined, false);
  assert.equal(replaced.selectedUnitId, undefined);
  assert.deepEqual(replaced.lastPresentedUnitIds, []);
});

test("database-backed factual turns are hard-gated to deterministic verified presentation", async () => {
  const formatter = new ConversationFormatterService();
  const presenter = new PropertyPresenterService(formatter);
  const answers = new DeterministicAnswerService(formatter, presenter, new PaymentPresenterService(formatter));
  const prisma = {
    conversation: { update: async () => ({}) },
    conversationState: { upsert: async () => ({}) },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  const service = new ChatService(
    { composeAnswer: async () => { throw new Error("model must not generate property facts"); } } as any,
    prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any,
    formatter, answers, new PaymentPresenterService(formatter), presenter, {} as any,
  );
  const facts = [unit("u1", 6_000_000, "Apartment")];
  const prepared = await (service as any).finishPreparation(
    "conversation-1", "ar-EG", { language: "ar-EG", turnIntent: "PROPERTY_SEARCH", queryObjective: "CHEAPEST" },
    { type: "text", uiActions: [] }, [{ role: "user", content: "ارخص وحدة" }], facts, facts, [], undefined,
    "PROPERTY_SEARCH", "control", undefined, { requestId: "test", requiresDatabase: true, propertySearchExecuted: true }, Date.now(),
  );
  assert.equal(prepared.trace.requiresGroq, false);
  assert.match(prepared.directAnswer, /Apartment/u);
  assert.match(prepared.directAnswer, /6,000,000 EGP/u);
});
