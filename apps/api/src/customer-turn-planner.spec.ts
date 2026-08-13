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
