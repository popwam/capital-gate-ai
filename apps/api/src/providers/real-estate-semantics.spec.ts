import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRealEstateSemantics } from "./real-estate-semantics";

test("Egyptian unit-area requirements are deterministic and remain across aggregation turns", () => {
  const first = normalizeRealEstateSemantics("عاوز بيت مساحته فوق 100 متر", { language: "ar-EG" }, { language: "ar-EG" });
  assert.equal(first.builtUpAreaMin, 100);
  const second = normalizeRealEstateSemantics("اي المساحات المتوفرة عندك", { language: "ar-EG" }, first);
  assert.equal(second.builtUpAreaMin, 100);
  assert.equal(second.temporaryIntent, "INVENTORY_AGGREGATION");
  assert.equal(second.aggregationDimension, "BUILT_UP_AREA");
});

test("explicit area ranges, targets and removal update state PATCH-style", () => {
  const range = normalizeRealEstateSemantics("عاوز من 150 لـ 180 متر", { language: "ar-EG" }, { language: "ar-EG" });
  assert.equal(range.builtUpAreaMin, 150);
  assert.equal(range.builtUpAreaMax, 180);
  const target = normalizeRealEstateSemantics("عاوز حوالي 155.67 متر", { language: "ar-EG" }, range);
  assert.equal(target.targetBuiltUpArea, 155.67);
  const cleared = normalizeRealEstateSemantics("خلاص مش فارقة المساحة", { language: "ar-EG" }, target);
  assert.equal(cleared.builtUpAreaMin, undefined);
  assert.equal(cleared.builtUpAreaMax, undefined);
});

const evaluations: Array<[string, string]> = [
  ["المساحات عندك إيه؟", "BUILT_UP_AREA"], ["اي المساحات المتوفرة؟", "BUILT_UP_AREA"], ["المساحة كام؟", "BUILT_UP_AREA"],
  ["إيه المناطق عندك؟", "LOCATION"], ["المناطق التانية الموجودة؟", "LOCATION"], ["what locations are available?", "LOCATION"],
  ["الأسعار المتاحة إيه؟", "PRICE"], ["ايه الأسعار الموجودة؟", "PRICE"], ["what prices are available?", "PRICE"],
  ["المشاريع الموجودة إيه؟", "PROJECT"], ["اي مشاريع متاحة؟", "PROJECT"], ["what projects are available?", "PROJECT"],
  ["المطورين الموجودين مين؟", "DEVELOPER"], ["إيه المطورون المتاحون؟", "DEVELOPER"], ["what developers are available?", "DEVELOPER"],
  ["أنواع الوحدات المتاحة إيه؟", "UNIT_TYPE"], ["ايه انواع الوحدات الموجودة؟", "UNIT_TYPE"], ["what unit types are available?", "UNIT_TYPE"],
  ["مواعيد التسليم المتاحة إيه؟", "DELIVERY_DATE"], ["اي مواعيد التسليم الموجودة؟", "DELIVERY_DATE"], ["what delivery dates are available?", "DELIVERY_DATE"],
  ["مدد السداد المتاحة إيه؟", "PAYMENT_DURATION"], ["سنين التقسيط الموجودة إيه؟", "PAYMENT_DURATION"], ["what payment durations are available?", "PAYMENT_DURATION"],
  ["عدد الغرف المتاح إيه؟", "BEDROOM_COUNT"], ["غرف النوم الموجودة كام؟", "BEDROOM_COUNT"], ["what bedroom counts are available?", "BEDROOM_COUNT"],
  ["المساحات الموجودة حوالي 150 إيه؟", "BUILT_UP_AREA"], ["المناطق الموجودة فين؟", "LOCATION"], ["prices available عندك إيه؟", "PRICE"],
];

test("30 natural Egyptian and mixed aggregation evaluations distinguish dimensions", () => {
  assert.equal(evaluations.length, 30);
  for (const [message, expected] of evaluations) {
    const result = normalizeRealEstateSemantics(message, { language: "ar-EG" }, { language: "ar-EG" });
    assert.equal(result.aggregationDimension, expected, message);
  }
});
