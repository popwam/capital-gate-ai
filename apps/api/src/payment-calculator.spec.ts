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

test("project discount percent is calculated from unit base price", () => {
  const quote = quotePaymentPlan({ durationMonths: 96, discountPercent: 10, downPaymentPercent: 10 }, 10_000_000, "EGP");
  assert.equal(quote.totalPrice, 9_000_000);
  assert.equal(quote.discountAmount, 1_000_000);
  assert.equal(quote.downPaymentAmount, 900_000);
});

test("fixed plan price overrides discount calculation", () => {
  const quote = quotePaymentPlan({ durationMonths: 60, totalPriceOverride: 8_500_000, discountPercent: 5 }, 10_000_000, "EGP");
  assert.equal(quote.totalPrice, 8_500_000);
  assert.equal(quote.discountAmount, 1_500_000);
});
