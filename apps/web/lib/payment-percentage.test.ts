import assert from "node:assert/strict";
import test from "node:test";
import { formatPaymentPercent, normalizedPaymentPercent } from "./payment-percentage.ts";

test("payment percentage display safely supports fractional and integer storage", () => {
  assert.equal(normalizedPaymentPercent(0.10), 10);
  assert.equal(normalizedPaymentPercent(0.15), 15);
  assert.equal(normalizedPaymentPercent(10), 10);
  assert.equal(formatPaymentPercent(0.10), "10%");
});
