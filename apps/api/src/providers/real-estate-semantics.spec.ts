import * as assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRealEstateSemantics } from "./real-estate-semantics";
import { deterministicIntent } from "./deterministic-intent";
import { applyDeterministicTurnSemantics, planCustomerTurn } from "../customer-turn-planner";
import { StructuredIntent } from "./ai-provider";

function turn(previous: StructuredIntent, source: string) {
  const plan = planCustomerTurn(source, previous);
  const extracted = normalizeRealEstateSemantics(source, deterministicIntent([{ role: "user", content: source }], previous), previous);
  return applyDeterministicTurnSemantics(source, extracted, previous, plan);
}

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

test("the reported multi-turn budget and investment lifecycle never revives removed state", () => {
  let state: StructuredIntent = { language: "ar-EG" };
  state = turn(state, "بفكر في حاجة بين 4 - 6 مليون تكون استثمارية");
  assert.equal(state.budgetMin, 4_000_000);
  assert.equal(state.budgetMax, 6_000_000);
  assert.equal(state.purpose, "INVESTMENT");

  state = turn(state, "لا ارخص من كدا اقل من 5 مليون");
  assert.equal(state.budgetMax, 5_000_000);
  assert.equal(state.purpose, "INVESTMENT");

  state = turn(state, "الغي الاستثمار مش لازم استثماري");
  assert.equal(state.purpose, undefined);
  assert.equal(state.budgetMax, 5_000_000, "removing purpose preserves the unrelated budget");

  state = turn(state, "الغي الشرط ال 5 م");
  assert.equal(state.budgetMin, undefined);
  assert.equal(state.budgetMax, undefined);
  assert.equal(state.priceMax, undefined);

  state = turn(state, "ارخص وحدة عندك نوعها اي");
  assert.equal(state.queryObjective, "CHEAPEST");
  assert.equal(state.propertyTypes, undefined);
  assert.equal(state.budgetMax, undefined);
});

test("Egyptian removal variants are semantic operations and preserve unrelated constraints", () => {
  const previous: StructuredIntent = { language: "ar-EG", budgetMax: 5_000_000, priceMax: 5_000_000, purpose: "INVESTMENT", locations: ["التجمع"], propertyTypes: ["Apartment"] };
  for (const source of ["الغي شرط السعر", "شيل الميزانية", "انس الميزانية", "فكك من الميزانية", "السعر مش مهم", "أي سعر"]) {
    const result = turn(previous, source);
    assert.equal(result.budgetMax, undefined, source);
    assert.equal(result.locations?.[0], "التجمع", source);
    assert.equal(result.purpose, "INVESTMENT", source);
  }
  for (const source of ["الغي الاستثمار", "مش لازم استثماري", "شيل شرط الاستثمار", "مش مهم النوع", "أي نوع"]) {
    const result = turn(previous, source);
    if (/الاستثمار|استثماري/u.test(source)) assert.equal(result.purpose, undefined, source);
    else assert.equal(result.propertyTypes, undefined, source);
    assert.equal(result.budgetMax, 5_000_000, source);
  }
});

test("explicit broadening relaxes search state while ordinary follow-ups never do", () => {
  const previous: StructuredIntent = { language: "ar-EG", budgetMax: 5_000_000, priceMax: 5_000_000, purpose: "INVESTMENT", locations: ["القاهرة"], propertyTypes: ["Apartment"] };
  const preserved = turn(previous, "طب وريني المتاح");
  assert.equal(preserved.budgetMax, 5_000_000);
  assert.equal(preserved.purpose, "INVESTMENT");

  const broadened = turn(previous, "وسع البحث");
  assert.equal(broadened.budgetMax, 5_000_000);
  assert.equal(broadened.priceMax, 5_000_000);
  assert.equal(broadened.purpose, undefined);
  assert.equal(broadened.propertyTypes, undefined);
  assert.equal(broadened.locations, undefined);
});

test("no-match confirmation widens non-financial scope without changing budget", () => {
  const previous: StructuredIntent = { language: "ar-EG", budgetMax: 5_000_000, priceMax: 5_000_000, presentation: { awaitingConfirmation: true, lastOfferedAction: "SEARCH_WIDEN" } };
  const plan = planCustomerTurn("أيوه", previous);
  const result = applyDeterministicTurnSemantics("أيوه", previous, previous, plan);
  assert.equal(plan.widenSearch, true);
  assert.equal(result.budgetMax, 5_000_000);
  assert.equal(result.priceMax, 5_000_000);
});

test("reported keep-budget then remove-type and broaden-location flow mutates dimensions independently", () => {
  let state: StructuredIntent = { language: "ar-EG", propertyTypes: ["Clinic"], locations: ["القاهرة"] };
  state = turn(state, "عاوز وحدة في حدود 3-5 م");
  assert.equal(state.budgetMin, 3_000_000);
  assert.equal(state.budgetMax, 5_000_000);

  state = normalizeRealEstateSemantics(
    "مش حابب اغير البادجيت",
    { language: "ar-EG", budgetMin: 3_000_000, budgetMax: 8_000_000 },
    state,
  );
  assert.equal(state.budgetMin, 3_000_000);
  assert.equal(state.budgetMax, 5_000_000, "explicit PRESERVE overrides a conflicting extracted patch");

  state = turn(state, "شيل النوع ووسع المنطقة");
  assert.equal(state.propertyTypes, undefined);
  assert.equal(state.locations, undefined);
  assert.equal(state.budgetMin, 3_000_000);
  assert.equal(state.budgetMax, 5_000_000);
  assert.equal(state.priceMax, undefined, "no separate price ceiling is invented during broadening");
});
