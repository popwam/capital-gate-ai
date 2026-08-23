import { ConstraintOperation, SearchConstraint, StructuredIntent } from "./ai-provider";

const normalize = (value: string) => value.toLowerCase().normalize("NFKC")
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/\s+/g, " ").trim();

const removalVerb = /(?:الغي|الغ|شيل|احذف|انس|انسي|فكك\s+من|سيب|من\s+غير|مش\s+(?:مهم(?:ه)?|لازم)|doesn'?t\s+matter|not\s+required|remove|drop|forget|ignore|without)/iu;

function targets(text: string): SearchConstraint[] {
  const values: SearchConstraint[] = [];
  if (/(?:ميزاني|السعر|سعر|budget|price)/iu.test(text)) values.push("BUDGET");
  if (/(?:استثمار|الغرض|purpose|investment|residential|سكن)/iu.test(text)) values.push("PURPOSE");
  if (/(?:نوع\s*(?:الوحده)?|نوعها|الوحدات|property\s*type|unit\s*type)/iu.test(text)) values.push("PROPERTY_TYPE");
  if (/(?:منطق|مكان|لوكيشن|location|area)/iu.test(text)) values.push("LOCATION");
  if (/(?:غرف|bedrooms?)/iu.test(text)) values.push("BEDROOMS");
  if (/(?:مساح|متر|built.?up)/iu.test(text)) values.push("AREA");
  if (/(?:مشروع|project)/iu.test(text)) values.push("PROJECT");
  if (/(?:مطور|developer)/iu.test(text)) values.push("DEVELOPER");
  if (/(?:سداد|تقسيط|قسط|مقدم|payment|installment)/iu.test(text)) values.push("PAYMENT");
  if (/(?:تسليم|delivery)/iu.test(text)) values.push("DELIVERY");
  if (/(?:قريب|بعيد|بواب|proximity|distance)/iu.test(text)) values.push("PROXIMITY");
  return [...new Set(values)];
}

export function inferConstraintOperations(source: string): ConstraintOperation[] {
  const text = normalize(source);
  const result: ConstraintOperation[] = [];
  const explicitTargets = targets(text);
  if (removalVerb.test(text) && /(?:شرط|condition).*?\d+(?:[.,]\d+)?\s*(?:م|m|mn|مليون)/iu.test(text) && !explicitTargets.includes("BUDGET"))
    explicitTargets.push("BUDGET");
  const anyConstraint = /(?:اي\s+سعر|السعر\s+ايا\s+كان|any\s+price)/iu.test(text)
    || /(?:اي\s+نوع|نوعها\s+اي|نوع\s+الوحده\s+ايا\s+كان|any\s+(?:unit\s+)?type)/iu.test(text)
    || /(?:اي\s+منطق(?:ه)?|المكان\s+ايا\s+كان|any\s+location)/iu.test(text);
  const remove = removalVerb.test(text) || anyConstraint;
  if (remove) for (const constraint of explicitTargets) result.push({ operation: "REMOVE", constraint });

  if (/(?:وسع|وسّع|نوسع|نوسّع|broaden|widen|expand)(?:\s+(?:البحث|search|النطاق))?/iu.test(text))
    result.push({ operation: "BROADEN", constraint: "SEARCH" });

  // An absolute cheapest/most-expensive request is a ranking objective, not a
  // new price ceiling. Existing location/bedroom constraints remain; stale
  // budget bounds do not, unless this turn supplies a new explicit bound.
  if (/(?:ارخص|اقل\s+سعر|cheapest|lowest\s+price|اغلي|أغلى|most\s+expensive|highest\s+price)/iu.test(text))
    result.push({ operation: "REMOVE", constraint: "BUDGET" });

  return result.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.operation === item.operation && candidate.constraint === item.constraint) === index);
}

export function queryObjective(source: string): StructuredIntent["queryObjective"] {
  const text = normalize(source);
  if (/(?:ارخص|اقل\s+سعر|cheapest|lowest\s+price)/iu.test(text)) return "CHEAPEST";
  if (/(?:اغلي|أغلى|اعلي\s+سعر|most\s+expensive|highest\s+price)/iu.test(text)) return "MOST_EXPENSIVE";
  if (/(?:احسن\s+مطابق|افضل\s+مطابق|best\s+match)/iu.test(text)) return "BEST_MATCH";
  return undefined;
}

const clear = (state: StructuredIntent, keys: Array<keyof StructuredIntent>) => {
  for (const key of keys) delete state[key];
};

export function applyConstraintOperations(state: StructuredIntent, operations: ConstraintOperation[]) {
  for (const item of operations) {
    if (item.operation === "BROADEN" && item.constraint === "SEARCH") {
      // The user explicitly authorized a wider result set. Relax the budget and
      // contextual purpose/project scope first, while keeping concrete location,
      // unit-type, bedroom and area requirements unless they are named too.
      clear(state, ["budgetMin", "budgetMax", "budgetFlexible", "budgetFlexibility", "priceTarget", "priceMin", "priceMax", "explicitRejectedPriceMin", "explicitRejectedPriceMax", "requestedProject", "preferredProjects", "preferredDevelopers", "purpose", "investmentRequirements"]);
      continue;
    }
    if (item.operation === "RESET" && item.constraint === "SEARCH") {
      for (const constraint of ["BUDGET","PURPOSE","PROPERTY_TYPE","LOCATION","BEDROOMS","AREA","PROJECT","DEVELOPER","PAYMENT","DELIVERY","PROXIMITY"] as SearchConstraint[])
        applyConstraintOperations(state, [{ operation: "REMOVE", constraint }]);
      continue;
    }
    if (item.operation !== "REMOVE") continue;
    switch (item.constraint) {
      case "BUDGET": clear(state, ["budgetMin","budgetMax","budgetFlexible","budgetFlexibility","priceTarget","priceMin","priceMax","explicitRejectedPriceMin","explicitRejectedPriceMax"]); break;
      case "PURPOSE": clear(state, ["purpose","investmentRequirements"]); break;
      case "PROPERTY_TYPE": clear(state, ["propertyTypes"]); break;
      case "LOCATION": clear(state, ["locations","rejectedLocations","maxTravelMinutes"]); break;
      case "BEDROOMS": clear(state, ["bedrooms","bathrooms"]); break;
      case "AREA": clear(state, ["minimumArea","maximumArea","builtUpAreaMin","builtUpAreaMax","targetBuiltUpArea"]); break;
      case "PROJECT": clear(state, ["requestedProject","preferredProjects","rejectedProjects","preferredPhase","preferredProjectZone","preferredBuilding"]); break;
      case "DEVELOPER": clear(state, ["preferredDevelopers"]); break;
      case "PAYMENT": clear(state, ["preferredPaymentMode","preferredPaymentDurationMonths","maxMonthlyInstallment","maxDownPayment","preferredDownPaymentPercent"]); break;
      case "DELIVERY": clear(state, ["deliveryMaxYears"]); break;
      case "PROXIMITY": clear(state, ["preferredGate","maxGateDistanceMeters","proximityPreferences"]); break;
    }
  }
}
