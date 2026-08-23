import { StructuredIntent } from "./ai-provider";
import { applyConstraintOperations, inferConstraintOperations, queryObjective } from "./constraint-lifecycle";
import { highConfidenceIntentPatch } from "./deterministic-intent";

const arabicDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9" };
const numberText = (value: string) => value.replace(/[٠-٩]/g, (digit) => arabicDigits[digit]);

export function normalizeRealEstateSemantics(source: string, extracted: StructuredIntent, previous: StructuredIntent): StructuredIntent {
  const text = numberText(source.toLowerCase()).replace(/م²|م٢/g, "متر");
  const highConfidence = highConfidenceIntentPatch(source);
  const next: StructuredIntent = { ...previous, ...extracted, ...highConfidence, requestedMedia: extracted.requestedMedia, exactRouteRequested: extracted.exactRouteRequested, routeOrigin: extracted.routeOrigin, routeDestination: extracted.routeDestination, temporaryIntent: undefined, aggregationDimension: undefined };
  const operations = [...(extracted.constraintOperations ?? []), ...inferConstraintOperations(source)];
  applyConstraintOperations(next, operations, previous);
  delete next.constraintOperations;
  const explicitObjective = queryObjective(source);
  next.searchRelaxationAuthorized = operations.some(item => item.operation !== "PRESERVE") || Boolean(explicitObjective) ? true : undefined;
  const searchKeys: Array<keyof StructuredIntent> = ["purpose","inventoryMarket","locations","propertyTypes","bedrooms","bathrooms","budgetMin","budgetMax","priceMin","priceMax","currency","deliveryMaxYears","maxDownPayment","maxTravelMinutes","builtUpAreaMin","builtUpAreaMax","targetBuiltUpArea","preferredFloor","preferredPhase","preferredProjectZone","preferredBuilding","preferredGate","preferredPaymentDurationMonths","maxMonthlyInstallment","preferredDownPaymentPercent","preferredDevelopers","preferredProjects","requestedProject"];
  const changedSearchConstraint = searchKeys.some((key) => JSON.stringify(next[key]) !== JSON.stringify(previous[key]) || Object.prototype.hasOwnProperty.call(highConfidence, key));
  const mutatedSearch = operations.some((item) => item.operation !== "PRESERVE");
  const startsNewSearch = /(?:عاوز|عايز|محتاج|دور|ابحث|find|search\s+for).{0,50}(?:وحد(?:ه|ة)?|عقار|بيت|شقه|شقة|فيلا|unit|property|home)/iu.test(text);
  next.queryObjective = explicitObjective ?? (changedSearchConstraint || mutatedSearch || startsNewSearch ? "BEST_MATCH" : previous.queryObjective);

  const explicitResale = /(?:ريسيل|ري\s*سيل|إعادة\s*بيع|اعادة\s*بيع|resale|secondary\s*market)/iu.test(text);
  const explicitPrimary = /(?:primary|من\s+المطور|بيع\s+أول|بيع\s+اول|أول\s+بيع|اول\s+بيع|new\s+from\s+(?:the\s+)?developer)/iu.test(text);
  if (explicitResale) next.inventoryMarket = "RESALE";
  else if (explicitPrimary) next.inventoryMarket = "PRIMARY";

  const clearArea = /(?:مش فارقة|مش مهم(?:ة)?|الغ[يِ]|شيل|من غير)\s+(?:لي\s+)?(?:المساحة|مساحة)/u.test(text);
  if (clearArea) { delete next.minimumArea; delete next.maximumArea; delete next.builtUpAreaMin; delete next.builtUpAreaMax; delete next.targetBuiltUpArea; }

  const unitAreaContext = /(?:مساح(?:ة|تها|ته|ات)|متر(?:\s*مربع)?|\d+\s*م(?:\b|\s)|أكبر\s+من\s+\d+)/u.test(text) && !/(?:منطق(?:ة|تها)|مناطق|لوكيشن|location)/iu.test(text);
  if (unitAreaContext && !clearArea) {
    const range = text.match(/(?:مساح(?:ة|ات).*?)?(\d+(?:[.,]\d+)?)\s*(?:متر)?\s*(?:ل(?:ـ|حد)?|إلى|الى|to|[-–])\s*(\d+(?:[.,]\d+)?)\s*(?:متر)?/u);
    const minimum = text.match(/(?:فوق|أكبر\s+من|اكثر\s+من|أكثر\s+من|minimum|min(?:imum)?)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)?/iu);
    const maximum = text.match(/(?:تحت|أقل\s+من|اقل\s+من|maximum|max(?:imum)?)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)?/iu);
    const target = text.match(/(?:حوالي|تقريب(?:ا|اً)?|around|about)\s*(\d+(?:[.,]\d+)?)\s*(?:متر|م\b)/iu);
    if (range) { next.builtUpAreaMin = Number(range[1].replace(",", ".")); next.builtUpAreaMax = Number(range[2].replace(",", ".")); }
    else { if (minimum) next.builtUpAreaMin = Number(minimum[1].replace(",", ".")); if (maximum) next.builtUpAreaMax = Number(maximum[1].replace(",", ".")); if (target) next.targetBuiltUpArea = Number(target[1].replace(",", ".")); }
    next.minimumArea = next.builtUpAreaMin; next.maximumArea = next.builtUpAreaMax;
  }

  const floorRange = text.match(/(?:من\s+)?(?:الدور|طابق|floor)\s*(\d+)\s*(?:ل(?:ـ|حد)?|إلى|الى|to|[-–])\s*(\d+)/iu);
  const floor = text.match(/(?:الدور|طابق|floor)\s*(?:ال)?(\d+)/iu);
  if (floorRange) { next.minimumFloor = Number(floorRange[1]); next.maximumFloor = Number(floorRange[2]); }
  else if (floor) next.preferredFloor = Number(floor[1]);

  const zone = text.match(/(?:زون|zone|كلستر|cluster)\s*([a-z0-9\u0600-\u06ff-]+)/iu);
  if (zone) next.preferredProjectZone = zone[1].trim();
  const phase = text.match(/(?:phase|مرحله|مرحلة)\s*([a-z0-9\u0600-\u06ff-]+)/iu);
  if (phase) next.preferredPhase = phase[1].trim();
  const building = text.match(/(?:building|مبنى|عماره|عمارة)\s*([a-z0-9\u0600-\u06ff-]+)/iu);
  if (building) next.preferredBuilding = building[1].trim();


  const paymentYears = text.match(/(?:تقسيط|سداد|على|مده|مدة|plan|payment).*?(\d+(?:[.,]\d+)?)\s*(?:سنه|سنة|سنين|years?|y\b)/iu);
  const paymentMonths = text.match(/(?:تقسيط|سداد|على|مده|مدة|plan|payment).*?(\d+)\s*(?:شهر|شهور|months?|mo\b)/iu);
  if (paymentYears) next.preferredPaymentDurationMonths = Math.round(Number(paymentYears[1].replace(",", ".")) * 12);
  if (paymentMonths) next.preferredPaymentDurationMonths = Number(paymentMonths[1]);

  const maxDp = text.match(/(?:المقدم|مقدم|down\s*payment|dp)\s*(?:ما\s*(?:يزيدش|يتعداش)|ميعديش|حده|حده\s*الاقصى|حد\s*اقصى|under|max(?:imum)?|<=?)?\s*(\d+(?:[.,]\d+)?)\s*(مليون|m|mn|million|الف|ألف|k)?/iu);
  if (maxDp) {
    const n = Number(maxDp[1].replace(",", "."));
    const unit = String(maxDp[2] ?? "").toLowerCase();
    next.maxDownPayment = unit.includes("مليون") || /^(?:m|mn|million)$/.test(unit) ? n * 1_000_000 : unit.includes("الف") || unit.includes("ألف") || unit === "k" ? n * 1_000 : n;
  }
  const monthly = text.match(/(?:القسط|قسط|installment).*?(?:شهري|monthly)?.*?(?:ما\s*(?:يزيدش|يتعداش)|ميعديش|under|max(?:imum)?|<=?)?\s*(\d+(?:[.,]\d+)?)\s*(مليون|m|mn|million|الف|ألف|k)?/iu);
  if (monthly && /(?:شهري|monthly|كل\s*شهر)/iu.test(text)) {
    const n = Number(monthly[1].replace(",", ".")); const unit = String(monthly[2] ?? "").toLowerCase();
    next.maxMonthlyInstallment = unit.includes("مليون") || /^(?:m|mn|million)$/.test(unit) ? n * 1_000_000 : unit.includes("الف") || unit.includes("ألف") || unit === "k" ? n * 1_000 : n;
  }

  const gateNumber = text.match(/(?:بوابه|بوابة|gate)\s*(?:رقم\s*)?(\d+)/iu);
  const mainGate = /(?:البوابه|البوابة|gate)\s*(?:الرئيسيه|الرئيسية|main)|main\s*gate/iu.test(text);
  const near = /(?:قريب|قريبه|قريبة|جنب|ناحيه|ناحية|near|close\s+to)/iu.test(text);
  const far = /(?:بعيد|بعيده|بعيدة|far\s+from|away\s+from)/iu.test(text);
  const distanceMeters = text.match(/(?:خلال|في\s+حدود|اقل\s+من|أقل\s+من|under|within)\s*(\d+)\s*(?:متر|meter|meters|m\b)/iu);
  if (gateNumber || mainGate) {
    next.preferredGate = mainGate ? "MAIN_GATE" : `Gate ${gateNumber![1]}`;
    if (distanceMeters) next.maxGateDistanceMeters = Number(distanceMeters[1]);
    const gatePref = { targetType: "GATE" as const, targetName: next.preferredGate, preference: far ? "FAR" as const : near ? "NEAR" as const : "ANY" as const, ...(distanceMeters ? { maxDistanceMeters: Number(distanceMeters[1]) } : {}) };
    next.proximityPreferences = [...(next.proximityPreferences ?? []).filter(p => p.targetType !== "GATE" || p.targetName !== gatePref.targetName), gatePref];
  }
  if (/(?:نص|وسط|منتصف)\s*(?:المشروع|الكمبوند|compound|project)/iu.test(text)) {
    next.proximityPreferences = [...(next.proximityPreferences ?? []).filter(p => p.targetType !== "PROJECT_CENTER"), { targetType: "PROJECT_CENTER", targetName: "PROJECT_CENTER", preference: "NEAR" }];
  }

  const asksAvailable = /(?:إيه|ايه|اي|ما|كام|قد\s*إيه|what|available|المتاحة|المتوفر(?:ة)?|الموجود(?:ة)?|عندك)/iu.test(text);
  if (asksAvailable) {
    let dimension: StructuredIntent["aggregationDimension"];
    if (/(?:المساحات|مساحات|مساحه|المساحة\s+(?:كام|قد\s*إيه))/u.test(text)) dimension = "BUILT_UP_AREA";
    else if (/(?:المناطق|مناطق|لوكيشن|locations?)/iu.test(text)) dimension = "LOCATION";
    else if (/(?:الأسعار|الاسعار|أسعار|prices?)/iu.test(text)) dimension = "PRICE";
    else if (/(?:المشاريع|مشاريع|projects?)/iu.test(text)) dimension = "PROJECT";
    else if (/(?:المطورين|المطورون|developers?)/iu.test(text)) dimension = "DEVELOPER";
    else if (/(?:أنواع\s+الوحدات|انواع\s+الوحدات|unit types?)/iu.test(text)) dimension = "UNIT_TYPE";
    else if (/(?:مواعيد\s+التسليم|delivery dates?)/iu.test(text)) dimension = "DELIVERY_DATE";
    else if (/(?:مدد\s+السداد|سنين\s+التقسيط|payment durations?)/iu.test(text)) dimension = "PAYMENT_DURATION";
    else if (/(?:عدد\s+الغرف|غرف\s+النوم|bedroom counts?)/iu.test(text)) dimension = "BEDROOM_COUNT";
    if (dimension) { next.temporaryIntent = "INVENTORY_AGGREGATION"; next.aggregationDimension = dimension; }
  }
  return next;
}
