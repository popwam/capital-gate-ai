import { Injectable } from "@nestjs/common";
import { CurrentSearchQueryTarget, NadimUnderstanding, NadimUnderstandingSchema, StateOperation } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { DialogueModelService } from "../providers/dialogue-model.service";

export type UnderstandingResult = {
  understanding: NadimUnderstanding;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number };
};

const LOCATION_TERMS = [
  "القاهرة الجديدة", "التجمع الخامس", "التجمع", "الشيخ زايد", "زايد", "العاصمة الإدارية",
  "العاصمة", "الساحل الشمالي", "الساحل", "أكتوبر", "اكتوبر", "new cairo", "fifth settlement",
  "sheikh zayed", "new capital", "north coast", "october",
];

function normalizedText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[٠-٩]/gu, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/gu, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/\s+/gu, " ")
    .trim();
}

function withFrancoSemanticHints(value: string) {
  if (/[^\u0000-\u007F]/u.test(value)) return value;
  return value
    .replace(/\b3ayza?\b/giu, "looking for")
    .replace(/\bsho2a\b/giu, "apartment")
    .replace(/\b(?:fel|f)\b/giu, "in")
    .replace(/\btagamo3\b/giu, "new cairo")
    .replace(/\bta7t\b/giu, "under")
    .replace(/\bkhalyha\b/giu, "make it")
    .replace(/\bkhalyhom\b/giu, "make them");
}

function looksLikeGibberish(value: string) {
  const compact = value.trim();
  return (!/[\p{L}\d]/u.test(compact) && compact.length > 0)
    || (/^[a-z]{4,}$/iu.test(compact) && !/[aeiouy]/iu.test(compact));
}

function isLanguageCapabilityQuery(text: string) {
  return /(?:بتتكلم|بتعرف\s+تتكلم|تعرف\s+(?:تتكلم\s+)?|بتقدر\s+تتكلم|هل\s+(?:تقدر|تستطيع|تعرف).{0,12}(?:تتكلم|تحكي)).{0,16}(?:إنجليزي|انجليزي|عربي|خليجي|سعودي|فصحى)|(?:can|do)\s+you\s+speak\s+(?:english|arabic)/iu.test(text);
}

function isAssistantCapabilitiesQuery(text: string) {
  return /(?:إنت|انت)?\s*(?:تقدر|تستطيع)\s+(?:تساعدني|تعمل|تسوي).{0,18}(?:ب?\s*(?:إيه|ايه|اي)|كيف|ازاي)?|ممكن\s+تساعدني\s+(?:إزاي|ازاي|كيف)|كيف\s+(?:أن|ان|تقدر|تستطيع)\s+تساعدني|وش\s+تقدر\s+تسوي|what\s+can\s+you\s+(?:help\s+me\s+with|do)|how\s+can\s+you\s+help\s+me/iu.test(text);
}

function isWellbeingSmallTalk(text: string) {
  return /^(?:كيفك|عامل\s+(?:إيه|ايه|اي)|أخبارك|اخبارك|شلونك|كيف\s+الحال|how\s+are\s+you|how['’]?s\s+it\s+going)[؟?!.،,\s]*$/iu.test(text);
}

function amount(raw: string, scale?: string, implicitMillions = false) {
  const value = Number(raw.replace(/,/gu, ""));
  if (!Number.isFinite(value) || value < 0) return undefined;
  if (/^(?:مليون|million|m)$/iu.test(scale ?? "") || (implicitMillions && value <= 500)) return value * 1_000_000;
  return value;
}

function ordinals(text: string) {
  const found: number[] = [];
  const terms: Array<[RegExp, number]> = [
    [/(?:الأول|الاول|الأولى|الاولى|first)(?=\s|$|[،,.!?])/iu, 1],
    [/(?:التاني(?:ة)?|الثاني(?:ة)?|second)(?=\s|$|[،,.!?])/iu, 2],
    [/(?:التالت(?:ة)?|الثالث(?:ة)?|third)(?=\s|$|[،,.!?])/iu, 3],
    [/(?:الرابع(?:ة)?|fourth)(?=\s|$|[،,.!?])/iu, 4],
  ];
  for (const [pattern, index] of terms) if (pattern.test(text)) found.push(index);
  return [...new Set(found)];
}

function hasActiveSearch(state: NadimState) {
  const search = state.search;
  return search.locations.length > 0
    || search.projects.length > 0
    || search.developers.length > 0
    || search.propertyTypes.length > 0
    || Object.entries(search).some(([field, value]) => !["locations", "projects", "developers", "propertyTypes"].includes(field) && value !== undefined)
    || state.lastResultIds.length > 0;
}

function stateQueryTarget(text: string, state: NadimState): CurrentSearchQueryTarget | undefined {
  const asksValue = /(?:كام|كم|قد\s*(?:إيه|ايه)|إيش|ايش|وش|what|how\s+(?:much|many)|where)/iu.test(text);
  if (asksValue && /(?:ميزاني[هة]|budget|الحد\s*الأقصى|الحد\s*الاقصى|max(?:imum)?)/iu.test(text)) return "budgetMax";
  if (asksValue && /(?:غرف|غرفة|bedrooms?|rooms?)/iu.test(text)) return "bedrooms";
  if (/(?:إحنا|احنا|حنا|we).{0,18}(?:بندور|ندور|looking).{0,12}(?:فين|وين|where)|(?:فين|وين|where).{0,15}(?:بندور|ندور|looking)/iu.test(text)) return "locations";
  if (/(?:المواصفات|تفاصيل\s+البحث).{0,28}(?:إيه|ايه|إيش|ايش|وش|كام|كم)|طلبت\s+(?:إيه|ايه)|what.{0,18}(?:looking for|preferences)|summari[sz]e.{0,15}search|search\s+(?:details|preferences).{0,12}(?:what|which|are)/iu.test(text)) return "SEARCH";
  if (state.search.budgetMax !== undefined && /(?:إحنا|احنا|حنا|we).{0,12}(?:وصلنا|at).{0,8}(?:ل)?(?:كام|كم|what)/iu.test(text)) return "budgetMax";
  return undefined;
}

function explicitUnderstanding(message: string, state: NadimState): NadimUnderstanding {
  const rawText = normalizedText(message);
  const text = withFrancoSemanticHints(rawText);
  const lower = text.toLowerCase();
  const operations: StateOperation[] = [];
  const activeSearch = hasActiveSearch(state);
  const modifyingSearch = /(?:خليها|خليه|خليهم|خلها|خلهم|نفس(?:ها|ه)?|نفس المواصفات|غي[ّ]?ر|عد[ّ]?ل|بدل|make it|make them|change|instead)/iu.test(text);
  const reset = /(?:ابد[أا]\s+(?:بحث|من جديد|من الأول|من الاول)|بحث جديد|نبدأ\s+من\s+(?:جديد|الأول|الاول)|سيب\s+اللي\s+فات|reset|new search|start over)/iu.test(text);
  const broadResetSearch = reset && /(?:امشي\s+(?:أي|اي)\s+حاجة|سيب\s+(?:كل\s+)?(?:الخيارات|المواصفات)\s+مفتوحة|anything|any(?:thing)?\s+(?:is\s+)?fine|search broadly)/iu.test(text);
  if (reset) operations.push({ operation: "RESET", field: "SEARCH" });

  const locations = LOCATION_TERMS.filter((term) => lower.includes(term.toLowerCase()));
  const openLocation = activeSearch && state.search.locations.length > 0
    && /(?:سيب|خلي|خل)\s+(?:المكان|الموقع)\s+(?:مفتوح|أي\s+مكان|اي\s+مكان)|(?:anywhere|any location|leave (?:the )?location open)/iu.test(text);
  const removeLocation = (locations.length > 0 && /(?:مش مهم|فكك من|شيل|الغي|الغى|انس|بدون|remove|not important)/iu.test(text)) || openLocation;
  if (removeLocation) operations.push({ operation: "REMOVE", field: "locations" });
  else if (locations.length) operations.push({ operation: "SET", field: "locations", value: locations.slice(0, 3) });

  const bedroom = text.match(/(?:(?:خليها|خليه|خليهم|خلها|خلهم|make it|make them)\s*)?(\d{1,2})\s*-?\s*(?:غرف(?:ة)?|rooms?|bed(?:room)?s?)/iu)
    ?? text.match(/(?:غرف(?:ة)?|rooms?|bed(?:room)?s?)\s*(\d{1,2})/iu);
  if (bedroom) operations.push({ operation: "SET", field: "bedrooms", value: Number(bedroom[1]) });
  const bathroom = text.match(/(\d{1,2})\s*(?:حمام|bathrooms?)/iu);
  if (bathroom) operations.push({ operation: "SET", field: "bathrooms", value: Number(bathroom[1]) });

  const maxBudget = text.match(/(?:تحت|لحد|ب?حد أقصى|ب?حد اقصى|الميزانية|ميزانية|budget(?:\s+(?:is|max))?|up to|under)\s*(\d[\d,.]*)\s*(مليون|million|m)?/iu);
  if (maxBudget) {
    const value = amount(maxBudget[1], maxBudget[2], /(?:الميزانية|ميزانية)/u.test(maxBudget[0]));
    if (value !== undefined) operations.push({ operation: "SET", field: "budgetMax", value });
  }
  const minBudget = text.match(/(?:من|ابتداء من|minimum|min(?:imum)?)\s*(\d[\d,.]*)\s*(مليون|million|m)/iu);
  if (minBudget) {
    const value = amount(minBudget[1], minBudget[2]);
    if (value !== undefined) operations.push({ operation: "SET", field: "budgetMin", value });
  }

  if (!maxBudget && activeSearch && modifyingSearch && state.search.budgetMax !== undefined) {
    const contextual = text.match(/(?:خليها|خليه|خلها|نفس(?:ها|ه)?(?:\s+بس)?|نفس\s+المواصفات(?:\s+بس)?|make it|change it(?:\s+to)?|instead)\s*(\d[\d,.]*)\s*(مليون|million|m)?/iu);
    if (contextual) {
      const numeric = Number(contextual[1].replace(/,/gu, ""));
      const clearImplicitMillions = !contextual[2] && numeric >= 10 && numeric <= 500 && state.search.budgetMax >= 1_000_000;
      const value = amount(contextual[1], contextual[2], clearImplicitMillions);
      if (value !== undefined && (Boolean(contextual[2]) || clearImplicitMillions)) {
        operations.push({ operation: "SET", field: "budgetMax", value });
      }
    }
  }

  const area = text.match(/(?:مساحة|area)\s*(?:من\s*)?(\d{2,5})(?:\s*(?:لحد|إلى|الى|to|-)?\s*(\d{2,5}))?/iu);
  if (area) {
    operations.push({ operation: "SET", field: "areaMin", value: Number(area[1]) });
    if (area[2]) operations.push({ operation: "SET", field: "areaMax", value: Number(area[2]) });
  }
  if (/(?:شقة|apartment|flat)/iu.test(text)) operations.push({ operation: "SET", field: "propertyTypes", value: ["Apartment"] });
  if (/(?:فيلا|villa)/iu.test(text)) operations.push({ operation: "SET", field: "propertyTypes", value: ["Villa"] });
  if (/(?:للاستثمار|استثمار|investment)/iu.test(text)) operations.push({ operation: "SET", field: "purpose", value: "INVESTMENT" });
  if (/(?:للسكن|سكن|living|home)/iu.test(text)) operations.push({ operation: "SET", field: "purpose", value: "LIVING" });
  if (/(?:الأرخص|الارخص|cheapest)/iu.test(text)) operations.push({ operation: "SET", field: "queryObjective", value: "CHEAPEST" });
  if (/(?:الأغلى|الاغلى|most expensive)/iu.test(text)) operations.push({ operation: "SET", field: "queryObjective", value: "MOST_EXPENSIVE" });

  // "من الأول" is a reset idiom, not an ordinal selection.
  const references = reset ? [] : ordinals(text);
  const unitReference = text.match(/\b(?:unit|وحدة)\s*[:#-]?\s*([\p{L}\d][\p{L}\d_\-/ ]{1,40})/iu)?.[1]?.trim();
  const hasSearch = /(?:عايز|عاوز|أبي|ابي|أبغى|ابغى|ودي|بدور|دورلي|وريني|ابحث|find|show me|looking for|\bneed\b|search)/iu.test(text);
  const resultSelection = references.length > 0 && state.lastResultIds.length > 0;
  const paymentPreferenceContext = hasSearch || (hasActiveSearch(state) && modifyingSearch);
  if (paymentPreferenceContext && /(?:تقسيط طويل|مدة أطول|مدة اطول|long(?:er)? installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "LONG_TERM" });
  } else if (paymentPreferenceContext && /(?:بالتقسيط|تقسيط|installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "INSTALLMENTS" });
  }
  const hasMutation = operations.some((operation) => operation.operation !== "PRESERVE") && !reset;
  const preserveRequest = activeSearch && /(?:لا\s+توس[ّ]?ع\s+(?:الخيارات|البحث)|خليك\s+على\s+نفس\s+المواصفات|نفس\s+المواصفات(?:\s*$)|keep\s+(?:it|the search)\s+(?:the )?same|don['’]?t\s+(?:widen|broaden|relax))/iu.test(text);
  if (preserveRequest) operations.unshift({ operation: "PRESERVE", field: "SEARCH" });
  const ambiguousRelativeChange = activeSearch
    && /(?:زودها|زوّدها|وسعها|وسّعها|increase it|raise it)\s+(?:شوية|شوي|a (?:bit|little))/iu.test(text)
    && !hasMutation;
  const queryTarget = stateQueryTarget(text, state);
  const paymentQuestion = /(?:نظام التقسيط|خطة السداد|خطط السداد|المقدم\s+كام|التقسيط\s+على\s+كام\s*(?:سنة|سنين|شهر)?|payment plan|down payment|how (?:many|long).*(?:installment|year|month))/iu.test(text);
  const addressOnlyRequest = state.languageStyle?.grammaticalAddressChangedThisTurn
    && /(?:صيغة|خاطبني|مؤنث|مذكر|محايد|address me|feminine|masculine|gender[- ]neutral)/iu.test(text);
  const languageOnly = Boolean(state.languageStyle?.explicitRequestThisTurn || addressOnlyRequest)
    && !hasMutation
    && !/(?:شقة|فيلا|وحدة|مشروع|سعر|ميزانية|تقسيط|مقدم|غرف|حمام|مساحة|متاح|صور|معاينة|حجز|apartment|villa|unit|project|price|budget|payment|bedroom|bathroom|area|available|media|viewing|reservation)/iu.test(text);
  let intent: NadimUnderstanding["intent"] = "UNKNOWN";
  if (/^(?:اهلا|أهلا|أهلين|هلا|السلام عليكم|صباح الخير|مساء الخير|hi|hello|hey)(?=\s|$|[،,.!?])/iu.test(text)) intent = "GREETING";
  if (hasSearch) intent = "PROPERTY_SEARCH";
  else if (hasMutation) intent = activeSearch ? "MODIFY_SEARCH" : "PROPERTY_SEARCH";
  if (reset) intent = broadResetSearch ? "PROPERTY_SEARCH" : "RESET_SEARCH";
  if (/(?:قارن|مقارنة|compare)/iu.test(text)) intent = "COMPARISON";
  else if (/(?:صور|صورة|photos?|images?|media)/iu.test(text)) intent = "MEDIA_REQUEST";
  else if (paymentQuestion && !["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent)) intent = "PAYMENT_PLAN_QUESTION";
  else if (/(?:السعر|سعرها|سعره|price|how much)/iu.test(text)) intent = "PRICE_QUESTION";
  else if (/(?:متاح|متاحة|availability|available)/iu.test(text) && !["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent)) intent = "AVAILABILITY_QUESTION";
  else if (/(?:الموقع|فين|location|where is)/iu.test(text) && !hasSearch) intent = "LOCATION_QUESTION";
  if (resultSelection && ["UNKNOWN", "PROPERTY_SEARCH"].includes(intent)) intent = "PROPERTY_QUESTION";
  if (/(?:احجز|حجز|reservation|reserve)/iu.test(text)) intent = "RESERVATION_REQUEST";
  else if (/(?:معاينة|viewing|visit)/iu.test(text)) intent = "VIEWING_REQUEST";
  else if (/(?:مش\s+عايز\s+أكمل\s+مع\s+(?:ال)?(?:ai|ذكاء)|عايز\s+(?:أكلم|اتكلم\s+مع)\s+حد|موظف|حد من المبيعات|human|sales agent|representative|talk to (?:a )?(?:person|human))/iu.test(text)) intent = "HUMAN_HANDOFF";
  else if (!languageOnly && /(?:كلمني|اتصل بي|اتصلوا|callback|call me)/iu.test(text)) intent = "CALLBACK_REQUEST";
  else if (/(?:سيب بياناتي|مهتم|contact me|lead)/iu.test(text)) intent = "LEAD_REQUEST";
  if (/(?:اسمك\s*(?:إيه|ايه|اي)?|إنت\s+مين|انت\s+مين|مين\s+نديم|what(?:'s| is)\s+your\s+name|who\s+are\s+you)/iu.test(text)) intent = "ASSISTANT_IDENTITY";
  else if (isLanguageCapabilityQuery(text)) intent = "LANGUAGE_CAPABILITY_QUERY";
  else if (isAssistantCapabilitiesQuery(text)) intent = "ASSISTANT_CAPABILITIES";
  else if (isWellbeingSmallTalk(text)) intent = "SMALL_TALK";
  else if (/(?:شكر[ًاا]?|متشكر|thank\s*you|thanks)/iu.test(text)
    || /(?:محتار|مش\s+عارف\s+أبدأ|مش\s+عارف\s+ابدأ|don['’]?t know where to start)/iu.test(text)
    || /^(?:تمام|ماشي|اوكي|أوكي|okay|ok|got it)[.!،,\s]*$/iu.test(text)) intent = "SMALL_TALK";
  if (state.languageStyle?.explicitRequestThisTurn && languageOnly) intent = "LANGUAGE_STYLE_CHANGE";
  else if (addressOnlyRequest && languageOnly) intent = "SMALL_TALK";
  if (preserveRequest && !hasMutation) intent = "CORRECTION";
  if (ambiguousRelativeChange) intent = "MODIFY_SEARCH";
  if (queryTarget) intent = "CURRENT_SEARCH_QUERY";
  const unintelligible = looksLikeGibberish(rawText);
  if (unintelligible) intent = "UNKNOWN";

  return {
    intent,
    confidence: unintelligible ? 0.95 : intent === "UNKNOWN" ? 0.35 : 0.9,
    locale: /[\u0600-\u06FF]/u.test(rawText) ? "ar-EG" : "en",
    operations: unintelligible ? [] : operations,
    ordinalReferences: references,
    unitReference,
    actionRequested: ["LEAD_REQUEST", "CALLBACK_REQUEST", "VIEWING_REQUEST", "RESERVATION_REQUEST", "HUMAN_HANDOFF"].includes(intent),
    stateQuery: queryTarget,
    ambiguity: ambiguousRelativeChange ? "SEARCH_CHANGE_AMOUNT_REQUIRED" : undefined,
  };
}

@Injectable()
export class UnderstandingService {
  constructor(private readonly dialogue: DialogueModelService) {}

  async understand(message: string, state: NadimState, trace: { conversationId?: string; requestId?: string } = {}): Promise<UnderstandingResult> {
    const deterministic = explicitUnderstanding(message, state);
    if (!this.dialogue.available()) return { understanding: deterministic };
    if (deterministic.intent === "UNKNOWN" && deterministic.confidence >= 0.8) return { understanding: deterministic };
    if (deterministic.intent === "LANGUAGE_STYLE_CHANGE"
      || (deterministic.intent === "SMALL_TALK" && state.languageStyle.grammaticalAddressChangedThisTurn)) {
      return { understanding: deterministic };
    }
    try {
      const result = await this.dialogue.understand(message, state, trace);
      const parsed = NadimUnderstandingSchema.safeParse(result.value);
      if (!parsed.success) return { understanding: deterministic };
      const explicitFields = new Set(deterministic.operations.map((operation) => operation.field));
      let mergedOperations = [
        ...parsed.data.operations.filter((operation) => !explicitFields.has(operation.field)),
        ...deterministic.operations,
      ];
      let intent = deterministic.confidence >= 0.8 ? deterministic.intent : parsed.data.intent;
      const stateQuery = deterministic.stateQuery ?? parsed.data.stateQuery;
      const modelRecoveryIsWeak = deterministic.intent === "UNKNOWN"
        && parsed.data.intent !== "UNKNOWN"
        && parsed.data.confidence < 0.7;
      const modelSearchHasNoMeaning = deterministic.intent === "UNKNOWN"
        && ["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(parsed.data.intent)
        && parsed.data.operations.length === 0
        && !parsed.data.ambiguity;
      const modelStateQueryHasNoTarget = parsed.data.intent === "CURRENT_SEARCH_QUERY" && !stateQuery;
      if (modelRecoveryIsWeak || modelSearchHasNoMeaning || modelStateQueryHasNoTarget) intent = deterministic.intent;
      if ([
        "GREETING", "ASSISTANT_IDENTITY", "ASSISTANT_CAPABILITIES", "LANGUAGE_CAPABILITY_QUERY",
        "LANGUAGE_STYLE_CHANGE", "CURRENT_SEARCH_QUERY", "CORRECTION", "SMALL_TALK", "UNKNOWN",
      ].includes(intent)) {
        mergedOperations = deterministic.operations.filter((operation) => operation.operation === "PRESERVE");
      }
      const understanding = {
        ...parsed.data,
        intent,
        confidence: Math.max(parsed.data.confidence, deterministic.confidence),
        locale: deterministic.locale ?? parsed.data.locale,
        operations: mergedOperations,
        ordinalReferences: deterministic.ordinalReferences.length ? deterministic.ordinalReferences : parsed.data.ordinalReferences,
        unitReference: deterministic.unitReference ?? parsed.data.unitReference,
        stateQuery,
        ambiguity: deterministic.ambiguity ?? parsed.data.ambiguity,
        // Model output may propose an action-shaped intent, but it cannot grant
        // execution authority. Only explicit deterministic language does that.
        actionRequested: deterministic.actionRequested,
      };
      return { understanding, model: { provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, latencyMs: result.latencyMs } };
    } catch {
      return { understanding: deterministic };
    }
  }
}
