import { Injectable } from "@nestjs/common";
import { NadimUnderstanding, NadimUnderstandingSchema, StateOperation } from "../domain/nadim-intent";
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
    .replace(/\bta7t\b/giu, "under");
}

function looksLikeGibberish(value: string) {
  const compact = value.trim();
  return /^[a-z]{4,}$/iu.test(compact) && !/[aeiouy]/iu.test(compact);
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

function explicitUnderstanding(message: string, state: NadimState): NadimUnderstanding {
  const rawText = normalizedText(message);
  const text = withFrancoSemanticHints(rawText);
  const lower = text.toLowerCase();
  const operations: StateOperation[] = [];
  const reset = /(?:ابد[أا]\s+(?:بحث|من جديد)|بحث جديد|reset|new search|start over)/iu.test(text);
  if (reset) operations.push({ operation: "RESET", field: "SEARCH" });

  const locations = LOCATION_TERMS.filter((term) => lower.includes(term.toLowerCase()));
  const removeLocation = locations.length > 0 && /(?:مش مهم|فكك من|شيل|الغي|الغى|انس|بدون|anywhere|remove|not important)/iu.test(text);
  if (removeLocation) operations.push({ operation: "REMOVE", field: "locations" });
  else if (locations.length) operations.push({ operation: "SET", field: "locations", value: locations.slice(0, 3) });

  const bedroom = text.match(/(?:خليها\s*)?(\d{1,2})\s*-?\s*(?:غرف(?:ة)?|rooms?|bed(?:room)?s?)/iu)
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

  const references = ordinals(text);
  const unitReference = text.match(/\b(?:unit|وحدة)\s*[:#-]?\s*([\p{L}\d][\p{L}\d_\-/ ]{1,40})/iu)?.[1]?.trim();
  const hasSearch = /(?:عايز|عاوز|أبي|ابي|أبغى|ابغى|ودي|بدور|دورلي|وريني|ابحث|find|show me|looking for|\bneed\b|search)/iu.test(text);
  const modifyingSearch = /(?:خليها|خليه|نفس المواصفات|غي[ّ]?ر|عد[ّ]?ل|بدل|make it|change|instead)/iu.test(text);
  const paymentPreferenceContext = hasSearch || (hasActiveSearch(state) && modifyingSearch);
  if (paymentPreferenceContext && /(?:تقسيط طويل|مدة أطول|مدة اطول|long(?:er)? installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "LONG_TERM" });
  } else if (paymentPreferenceContext && /(?:بالتقسيط|تقسيط|installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "INSTALLMENTS" });
  }
  const hasMutation = operations.some((operation) => operation.operation !== "PRESERVE") && !reset;
  const activeSearch = hasActiveSearch(state);
  const paymentQuestion = /(?:نظام التقسيط|خطة السداد|خطط السداد|المقدم\s+كام|التقسيط\s+على\s+كام\s*(?:سنة|سنين|شهر)?|payment plan|down payment|how (?:many|long).*(?:installment|year|month))/iu.test(text);
  const languageOnly = Boolean(state.languageStyle?.changedThisTurn || state.languageStyle?.grammaticalAddressChangedThisTurn)
    && !hasMutation
    && !/(?:شقة|فيلا|وحدة|مشروع|سعر|ميزانية|تقسيط|مقدم|غرف|حمام|مساحة|متاح|صور|معاينة|حجز|apartment|villa|unit|project|price|budget|payment|bedroom|bathroom|area|available|media|viewing|reservation)/iu.test(text);
  let intent: NadimUnderstanding["intent"] = "UNKNOWN";
  if (/^(?:اهلا|أهلا|السلام عليكم|صباح الخير|مساء الخير|hi|hello|hey)(?=\s|$|[،,.!?])/iu.test(text)) intent = "GREETING";
  if (hasSearch) intent = "PROPERTY_SEARCH";
  else if (hasMutation) intent = activeSearch ? "MODIFY_SEARCH" : "PROPERTY_SEARCH";
  if (reset) intent = "RESET_SEARCH";
  if (/(?:قارن|مقارنة|compare)/iu.test(text)) intent = "COMPARISON";
  else if (/(?:صور|صورة|photos?|images?|media)/iu.test(text)) intent = "MEDIA_REQUEST";
  else if (paymentQuestion && !["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent)) intent = "PAYMENT_PLAN_QUESTION";
  else if (/(?:السعر|سعرها|سعره|price|how much)/iu.test(text)) intent = "PRICE_QUESTION";
  else if (/(?:متاح|متاحة|availability|available)/iu.test(text)) intent = "AVAILABILITY_QUESTION";
  else if (/(?:الموقع|فين|location|where is)/iu.test(text) && !hasSearch) intent = "LOCATION_QUESTION";
  if (/(?:احجز|حجز|reservation|reserve)/iu.test(text)) intent = "RESERVATION_REQUEST";
  else if (/(?:معاينة|viewing|visit)/iu.test(text)) intent = "VIEWING_REQUEST";
  else if (!languageOnly && /(?:كلمني|اتصل بي|اتصلوا|callback|call me)/iu.test(text)) intent = "CALLBACK_REQUEST";
  else if (/(?:موظف|حد من المبيعات|human|sales agent|representative)/iu.test(text)) intent = "HUMAN_HANDOFF";
  else if (/(?:سيب بياناتي|مهتم|contact me|lead)/iu.test(text)) intent = "LEAD_REQUEST";
  if (languageOnly) intent = "SMALL_TALK";
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
  };
}

@Injectable()
export class UnderstandingService {
  constructor(private readonly dialogue: DialogueModelService) {}

  async understand(message: string, state: NadimState, trace: { conversationId?: string; requestId?: string } = {}): Promise<UnderstandingResult> {
    const deterministic = explicitUnderstanding(message, state);
    if (!this.dialogue.available()) return { understanding: deterministic };
    if (deterministic.intent === "UNKNOWN" && deterministic.confidence >= 0.8) return { understanding: deterministic };
    if (deterministic.intent === "SMALL_TALK"
      && (state.languageStyle.changedThisTurn || state.languageStyle.grammaticalAddressChangedThisTurn)) {
      return { understanding: deterministic };
    }
    try {
      const result = await this.dialogue.understand(message, state, trace);
      const parsed = NadimUnderstandingSchema.safeParse(result.value);
      if (!parsed.success) return { understanding: deterministic };
      const explicitFields = new Set(deterministic.operations.map((operation) => operation.field));
      const mergedOperations = [
        ...parsed.data.operations.filter((operation) => !explicitFields.has(operation.field)),
        ...deterministic.operations,
      ];
      const understanding = {
        ...parsed.data,
        intent: deterministic.confidence >= 0.8 ? deterministic.intent : parsed.data.intent,
        confidence: Math.max(parsed.data.confidence, deterministic.confidence),
        locale: deterministic.locale ?? parsed.data.locale,
        operations: mergedOperations,
        ordinalReferences: deterministic.ordinalReferences.length ? deterministic.ordinalReferences : parsed.data.ordinalReferences,
        unitReference: deterministic.unitReference ?? parsed.data.unitReference,
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
