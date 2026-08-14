import assert from "node:assert/strict";
import test from "node:test";
import { chooseBestPaymentPlan, quotePaymentPlan } from "./payment-calculator";

test("96 month plan calculates down payment and monthly equivalent", () => {
  const quote = quotePaymentPlan({ durationMonths: 96, downPaymentPercent: 10, totalPrice: 10_000_000, installmentFrequency: "MONTHLY" }, 10_000_000, "EGP");
  assert.equal(quote.downPaymentAmount, 1_000_000);
  assert.equal(Math.round(quote.monthlyEquivalent!), 93_750);
});

test("preferred duration selects 96 months", () => {
  const best = chooseBestPaymentPlan([{ durationMonths: 60, totalPrice: 10_000_000 }, { durationMonths: 96, totalPrice: 10_000_000 }], 10_000_000, "EGP", { preferredPaymentDurationMonths: 96 });
  assert.equal(best?.durationMonths, 96);
});
