import * as assert from "node:assert/strict";
import { test } from "node:test";
import { applyDeterministicTurnSemantics, exactExternalUnitId, planCustomerTurn, unpresentedUnitIds } from "./customer-turn-planner";
import { StructuredIntent } from "./providers/ai-provider";

const state = (extra: Partial<StructuredIntent> = {}): StructuredIntent => ({ language: "ar-EG", ...extra });

test("greeting is text-only and requires no database or Workers extraction", () => {
  const plan = planCustomerTurn("مساء الفل", state());
  assert.equal(plan.intent, "SMALL_TALK");
  assert.equal(plan.requiresDatabase, false);
  assert.equal(plan.requiresExtraction, false);
  assert.equal(plan.emitCards, false);
});


test("help question with colloquial typo never falls through to inventory search", () => {
  const plan = planCustomerTurn("تقدر تساععدني ب اي", state());
  assert.equal(plan.intent, "SMALL_TALK");
  assert.equal(plan.requiresDatabase, false);
  assert.equal(plan.requiresExtraction, false);
  assert.match(plan.deterministicResponse ?? "", /أقدر أساعدك/);
});

test("ordinary search remains text-only until options are explicitly requested", () => {
  assert.equal(planCustomerTurn("عاوز شقة حوالي 10 مليون", state()).emitCards, false);
  assert.equal(planCustomerTurn("وريني الاختيارات", state()).emitCards, true);
});

test("a confirmation executes only the action previously offered", () => {
  const plan = planCustomerTurn("أيوه", state({ presentation: { awaitingConfirmation: true, lastOfferedAction: "PROPERTY_CARDS" } }));
  assert.equal(plan.intent, "FOLLOW_UP_CONFIRMATION");
  assert.equal(plan.emitCards, true);
});

test("G60 4/2 is an exact external unit identifier and never room counts", () => {
  const source = "I want to book a viewing for unit G60 4/2";
  const plan = planCustomerTurn(source, state({ bedrooms: 2, bathrooms: 1 }));
  const result = applyDeterministicTurnSemantics(source, { language: "en", bedrooms: 4, bathrooms: 2 }, state({ bedrooms: 2, bathrooms: 1 }), plan);
  assert.equal(exactExternalUnitId(source), "G60 4/2");
  assert.equal(result.externalUnitId, "G60 4/2");
  assert.equal(result.bedrooms, 2);
  assert.equal(result.bathrooms, 1);
});

test("target, rejected 12M, strict correction, and under-11 semantics are hard filters", () => {
  let previous = state();
  let source = "عاوز حاجة في حدود 10 مليون ممكن أزود حاجة بسيطة بس مش 12";
  let result = applyDeterministicTurnSemantics(source, previous, previous, planCustomerTurn(source, previous));
  assert.equal(result.priceTarget, 10_000_000);
  assert.equal(result.priceMax, 10_500_000);
  assert.equal(result.explicitRejectedPriceMin, 11_700_000);
  source = "لا عاوزها 10";
  result = applyDeterministicTurnSemantics(source, result, result, planCustomerTurn(source, result));
  assert.equal(result.priceMax, 10_000_000);
  assert.equal(result.budgetFlexibility, "NONE");
  source = "في وحدة أقل من 11؟";
  result = applyDeterministicTurnSemantics(source, result, result, planCustomerTurn(source, result));
  assert.equal(result.priceMax, 11_000_000);
  assert.equal(result.budgetFlexibility, "NONE");
});

test("deterministic tool intents do not emit property cards", () => {
  for (const source of ["كام عدد الوحدات؟", "وريني الصور", "البروشور موجود؟", "فين المشروع؟", "بينه وبين AUC كام؟"]) {
    assert.equal(planCustomerTurn(source, state()).emitCards, false, source);
  }
});

test("already presented property cards are not emitted again", () => {
  assert.deepEqual(unpresentedUnitIds(["u1", "u2", "u3"], ["u1", "u2"]), ["u3"]);
  assert.deepEqual(unpresentedUnitIds(["u1", "u2"], ["u1", "u2"]), []);
});

test("bare and Unicode-dash unit codes resolve as exact inventory references", () => {
  assert.equal(exactExternalUnitId("ls8-c-402"), "ls8-c-402");
  assert.equal(exactExternalUnitId("LS8‑C‑402"), "LS8-C-402");
  assert.equal(planCustomerTurn("ls8-c-402", state()).intent, "PROPERTY_DETAILS");
});

test("natural map, distance and cash questions route to deterministic tools", () => {
  assert.equal(planCustomerTurn("وريني موقع مشروع test", state()).intent, "LOCATION_REQUEST");
  assert.equal(planCustomerTurn("هو بعيد قد اي عن الجامعة الامريكية", state()).intent, "DISTANCE_REQUEST");
  assert.equal(planCustomerTurn("سعرها كام لو هدفع كاش", state()).intent, "PAYMENT_PLAN");
});

test("contact preference replies stay inside the lead handoff instead of becoming a property search", () => {
  const previous = state({ presentation: { awaitingConfirmation: true, lastOfferedAction: "CONTACT_REQUEST", leadHandoffStage: "CONTACT_PREFERENCES" } });
  assert.equal(planCustomerTurn("التواصل واتساب والتأكيد SMS", previous).intent, "CONTACT_REQUEST");
});

test("identity replies stay inside the lead handoff", () => {
  const previous = state({ presentation: { awaitingConfirmation: true, lastOfferedAction: "CONTACT_REQUEST", leadHandoffStage: "IDENTITY" } });
  assert.equal(planCustomerTurn("ممدوح ممدوح 01033662552", previous).intent, "CONTACT_REQUEST");
});

test("a short invalid phone attempt still stays inside contact verification", () => {
  const previous = state({ presentation: { awaitingConfirmation: true, lastOfferedAction: "CONTACT_REQUEST", leadHandoffStage: "IDENTITY" } });
  assert.equal(planCustomerTurn("test 12345", previous).intent, "CONTACT_REQUEST");
});
