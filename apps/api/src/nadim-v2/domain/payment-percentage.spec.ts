import { strict as assert } from "node:assert";
import { test } from "node:test";
import { customerPaymentPercent } from "./payment-percentage";

test("customer payment percentages normalize fractional and integer representations", () => {
  assert.equal(customerPaymentPercent(0.10), 10);
  assert.equal(customerPaymentPercent("0.15"), 15);
  assert.equal(customerPaymentPercent(10), 10);
  assert.equal(customerPaymentPercent(100), 100);
  assert.equal(customerPaymentPercent(101), undefined);
});
