import { ConstraintOperation, SearchConstraint, StructuredIntent } from "./ai-provider";

const normalize = (value: string) => value.toLowerCase().normalize("NFKC")
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
  .replace(/\s+/g, " ").trim();

const removalVerb = /(?:الغي|الغ|شيل|احذف|انس|انسي|فكك\s+من|سيب|من\s+غير|مش\s+(?:مهم(?:ه)?|لازم|فارق(?:ه)?)|doesn'?t\s+matter|not\s+required|remove|drop|forget|ignore|without)/iu;
const resetVerb = /(?:اعاد(?:ه|ة)\s+ضبط|ابد[اأ]\s+من\s+جديد|صف[رّ]|reset)/iu;
const preserveVerb = /(?:(?:مش|موش)\s+(?:حابب|عايز|عاوز|محتاج)\s+(?:ا?غير|نغير|تغير)|(?:خلي|ثبت|سيب).{0,20}(?:زي\s+ما|نفس)|don'?t\s+change|do\s+not\s+change|keep|preserve|same)/iu;

export function isPropertyTypeQuestion(source: string): boolean {
  const text = normalize(source);
  return /(?:نوعها|نوعه|نوع\s+(?:الوحده|الوحدة))\s*(?:اي|ايه|إيه|ما\s+هو)|what\s+(?:is\s+)?(?:its|the\s+unit'?s?)\s+type/iu.test(text);
}

function targets(text: string): SearchConstraint[] {
  const values: SearchConstraint[] = [];
  if (/(?:ميزاني|بادج(?:ت|يت)|السعر|سعر|budget|price)/iu.test(text)) values.push("BUDGET");
  if (/(?:استثمار|الغرض|purpose|investment|residential|سكن)/iu.test(text)) values.push("PURPOSE");
  if (/(?:نوع\s*(?:الوحده)?|نوعها|الوحدات|property\s*type|unit\s*type|شقه|شقة|apartment|flat|عياده|عيادة|clinic|فيلا|villa|تاون\s*هاوس|town\s*house|توين\s*هاوس|twin\s*house|دوبلكس|duplex|محل|retail|shop|مكتب|office)/iu.test(text)) values.push("PROPERTY_TYPE");
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
  if (isPropertyTypeQuestion(source)) result.push({ operation: "PRESERVE", constraint: "PROPERTY_TYPE" });
  const preservedTargets = preserveVerb.test(text) ? explicitTargets : [];
  for (const constraint of preservedTargets) result.push({ operation: "PRESERVE", constraint });
  if (resetVerb.test(text)) {
    const resetTargets = explicitTargets.length ? explicitTargets : ["SEARCH" as const];
    for (const constraint of resetTargets) result.push({ operation: "RESET", constraint });
  }
  if (removalVerb.test(text) && /(?:شرط|condition).*?\d+(?:[.,]\d+)?\s*(?:م|m|mn|مليون)/iu.test(text) && !explicitTargets.includes("BUDGET"))
    explicitTargets.push("BUDGET");
  const anyConstraint = /(?:اي\s+سعر|السعر\s+ايا\s+كان|any\s+price)/iu.test(text)
    || /(?:اي\s+نوع|نوع\s+الوحده\s+ايا\s+كان|any\s+(?:unit\s+)?type)/iu.test(text)
    || /(?:اي\s+منطق(?:ه)?|المكان\s+ايا\s+كان|any\s+location)/iu.test(text);
  const remove = removalVerb.test(text) || anyConstraint;
  if (remove) for (const constraint of explicitTargets.filter(constraint => !preservedTargets.includes(constraint))) result.push({ operation: "REMOVE", constraint });

  const broaden = text.match(/(?:وسع|وسّع|نوسع|نوسّع|broaden|widen|expand)(?:\s+(?:البحث|search|النطاق))?/iu);
  if (broaden) {
    const nearbyText = text.slice(broaden.index ?? 0, (broaden.index ?? 0) + 40);
    const scopedTargets = targets(nearbyText).filter(constraint => !preservedTargets.includes(constraint));
    if (/(?:البحث|search|النطاق)/iu.test(broaden[0]) || !scopedTargets.length) result.push({ operation: "BROADEN", constraint: "SEARCH" });
    else for (const constraint of scopedTargets) result.push({ operation: "BROADEN", constraint });
  }

  return result.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.operation === item.operation && candidate.constraint === item.constraint) === index);
}

export function queryObjective(source: string): StructuredIntent["queryObjective"] {
  const text = normalize(source);
  if (/(?:ارخص|اقل\s+سعر|cheapest|lowest\s+price)/iu.test(text)) return "CHEAPEST";
  if (/(?:اقل\s+مقدم|lowest\s+down\s*payment)/iu.test(text)) return "LOWEST_DOWN_PAYMENT";
  if (/(?:اقل\s+قسط|lowest\s+installment)/iu.test(text)) return "LOWEST_INSTALLMENT";
  if (/(?:اقرب\s+استلام|earliest\s+delivery)/iu.test(text)) return "EARLIEST_DELIVERY";
  if (/(?:اكبر\s+مساحه|largest\s+area)/iu.test(text)) return "LARGEST_AREA";
  if (/(?:اغلي|أغلى|اعلي)\s+(?:سعر|حاجه)?\s*.{0,20}(?:ميزاني|حدود)|most\s+expensive\s+within|highest\s+within/iu.test(text)) return "HIGHEST_WITHIN_BUDGET";
  if (/(?:اغلي|أغلى|اعلي\s+سعر|most\s+expensive|highest\s+price)/iu.test(text)) return "MOST_EXPENSIVE";
  if (/(?:احسن\s+مطابق|افضل\s+مطابق|best\s+match)/iu.test(text)) return "BEST_MATCH";
  return undefined;
}

const clear = (state: StructuredIntent, keys: Array<keyof StructuredIntent>) => {
  for (const key of keys) delete state[key];
};

const constraintKeys = (constraint: SearchConstraint): Array<keyof StructuredIntent> => {
  switch (constraint) {
    case "BUDGET": return ["budgetMin","budgetMax","budgetFlexible","budgetFlexibility","priceTarget","priceMin","priceMax","explicitRejectedPriceMin","explicitRejectedPriceMax","currency"];
    case "PURPOSE": return ["purpose","investmentRequirements"];
    case "PROPERTY_TYPE": return ["propertyTypes"];
    case "LOCATION": return ["locations","rejectedLocations","maxTravelMinutes"];
    case "BEDROOMS": return ["bedrooms","bathrooms"];
    case "AREA": return ["minimumArea","maximumArea","builtUpAreaMin","builtUpAreaMax","targetBuiltUpArea"];
    case "PROJECT": return ["requestedProject","preferredProjects","rejectedProjects","preferredPhase","preferredProjectZone","preferredBuilding"];
    case "DEVELOPER": return ["preferredDevelopers"];
    case "PAYMENT": return ["preferredPaymentMode","preferredPaymentDurationMonths","maxMonthlyInstallment","maxDownPayment","preferredDownPaymentPercent"];
    case "DELIVERY": return ["deliveryMaxYears"];
    case "PROXIMITY": return ["preferredGate","maxGateDistanceMeters","proximityPreferences"];
  }
};

const restore = (state: StructuredIntent, previous: StructuredIntent, keys: Array<keyof StructuredIntent>) => {
  for (const key of keys) {
    if (previous[key] === undefined) delete state[key];
    else Object.assign(state, { [key]: previous[key] });
  }
};

export function applyConstraintOperations(state: StructuredIntent, operations: ConstraintOperation[], previous: StructuredIntent = state) {
  for (const item of operations) {
    if (item.operation === "BROADEN" && item.constraint === "SEARCH") {
      // A generic wider search removes non-financial scope only. Budget and
      // payment constraints require an explicit budget/payment mutation.
      for (const constraint of ["PURPOSE", "PROPERTY_TYPE", "LOCATION", "PROJECT", "DEVELOPER"] as SearchConstraint[])
        clear(state, constraintKeys(constraint));
      continue;
    }
    if (item.operation === "RESET" && item.constraint === "SEARCH") {
      for (const constraint of ["BUDGET","PURPOSE","PROPERTY_TYPE","LOCATION","BEDROOMS","AREA","PROJECT","DEVELOPER","PAYMENT","DELIVERY","PROXIMITY"] as SearchConstraint[])
        applyConstraintOperations(state, [{ operation: "REMOVE", constraint }], previous);
      continue;
    }
    if (item.constraint === "SEARCH") continue;
    const keys = constraintKeys(item.constraint);
    if (item.operation === "PRESERVE") restore(state, previous, keys);
    else if (item.operation === "REMOVE" || item.operation === "RESET" || item.operation === "BROADEN") clear(state, keys);
  }
}
