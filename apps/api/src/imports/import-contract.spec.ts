import * as assert from "node:assert/strict";
import { test } from "node:test";
import { CANONICAL_FIELDS, CORE_UNIT_CANONICAL_VALUES, METADATA_CANONICAL_VALUES, customMetadataLabel, isCustomMetadataField, normalizeFinishing, parseImportDate, parsePaymentPlanComponentHeader, parsePaymentPlanHeader } from "./import-contract";

test("payment-plan columns parse years, months, decimals, Arabic and arbitrary durations", () => {
  assert.equal(parsePaymentPlanHeader("Properties Unit Price 8 Y")?.durationMonths, 96);
  assert.equal(parsePaymentPlanHeader("Unit Price 60 Months")?.durationMonths, 60);
  assert.equal(parsePaymentPlanHeader("Price 1.5 Years")?.durationMonths, 18);
  assert.equal(parsePaymentPlanHeader("Price 66 Months")?.durationMonths, 66);
  assert.equal(parsePaymentPlanHeader("سعر تقسيط 10 سنوات")?.durationMonths, 120);
  assert.equal(parsePaymentPlanHeader("Properties Standard Unit Price"), undefined);
});

test("payment components preserve amount versus percentage semantics", () => {
  assert.equal(parsePaymentPlanComponentHeader("DP")?.valueType, "DOWN_PAYMENT_AMOUNT");
  assert.equal(parsePaymentPlanComponentHeader("Down Payment %")?.valueType, "DOWN_PAYMENT_PERCENT");
  assert.equal(parsePaymentPlanComponentHeader("Maintenance")?.valueType, "MAINTENANCE_AMOUNT");
  assert.equal(parsePaymentPlanComponentHeader("Maintenance %")?.valueType, "MAINTENANCE_PERCENT");
});

test("delivery parser accepts explicit day-first, ISO, Excel serial and Date values", () => {
  assert.equal(parseImportDate("28-02-2027")?.toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(parseImportDate("28/02/2027")?.toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(parseImportDate("2027-02-28")?.toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(parseImportDate("31-02-2027"), undefined);
  assert.ok(parseImportDate(46_000) instanceof Date);
  assert.equal(parseImportDate(new Date(2027, 1, 28))?.toISOString(), "2027-02-28T00:00:00.000Z");
});

test("known finishing values normalize without losing the original source provenance", () => {
  assert.equal(normalizeFinishing("Semi-Finished"), "SEMI_FINISHED");
  assert.equal(normalizeFinishing("Core & Shell"), "CORE_AND_SHELL");
  assert.equal(normalizeFinishing("Furnished"), "FURNISHED");
});


test("real-estate canonical vocabulary is broad and keeps extended fields without schema loss", () => {
  assert.ok(CANONICAL_FIELDS.length >= 200);
  assert.ok(CORE_UNIT_CANONICAL_VALUES.includes("externalUnitId"));
  assert.ok(METADATA_CANONICAL_VALUES.includes("pricePerSqm"));
  assert.ok(METADATA_CANONICAL_VALUES.includes("expectedYield"));
  assert.ok(METADATA_CANONICAL_VALUES.includes("commercialActivity"));
  assert.ok(METADATA_CANONICAL_VALUES.includes("titleDeedStatus"));
  assert.ok(METADATA_CANONICAL_VALUES.includes("warehouseClearHeight"));
});

test("custom import fields can be typed instead of selected from the taxonomy", () => {
  assert.equal(isCustomMetadataField("META:Owner mobile"), true);
  assert.equal(customMetadataLabel("META:Owner mobile"), "Owner mobile");
  assert.equal(isCustomMetadataField("Owner mobile"), false);
});
