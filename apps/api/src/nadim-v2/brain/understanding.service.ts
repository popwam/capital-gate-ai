import { Injectable } from "@nestjs/common";
import { NadimBrainDecision } from "../domain/nadim-brain-decision";
import { NadimConversationContext } from "../domain/nadim-conversation-context";
import {
  CurrentSearchQueryTarget,
  NadimSemanticInterpretation,
  NadimSemanticInterpretationSchema,
  NadimUnderstanding,
  StateOperation,
} from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { DialogueModelService } from "../providers/dialogue-model.service";
import { DialogueProviderChainError } from "../providers/dialogue-provider";
import { extractFollowUpTemporalRequest } from "../product/follow-up-time";

export type UnderstandingResult = {
  understanding: NadimUnderstanding;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number; fallbackStage?: string };
  brainDecision?: NadimBrainDecision;
  providerErrorCategory?: string;
  providerLatencyMs?: number;
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
  const latinToken = /^[a-z]{8,}$/iu.test(compact) ? compact.toLowerCase() : undefined;
  const vowelRatio = latinToken
    ? (latinToken.match(/[aeiouy]/gu)?.length ?? 0) / latinToken.length
    : 1;
  return (!/[\p{L}\d]/u.test(compact) && compact.length > 0)
    || (/^[a-z]{4,}$/iu.test(compact) && !/[aeiouy]/iu.test(compact))
    || Boolean(latinToken && vowelRatio < 0.3 && /[bcdfghjklmnpqrstvwxz]{4,}/iu.test(latinToken));
}

function looksLikeNaturalConversation(value: string) {
  const tokens = value.normalize("NFKC").match(/[\p{L}\d]+/gu) ?? [];
  return tokens.length >= 2 && tokens.some((token) => /\p{L}/u.test(token));
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
  if (/^(?:ألف|الف|thousand|k)$/iu.test(scale ?? "")) return value * 1_000;
  return value;
}

function currencyCode(value: string) {
  if (/(?:USD|دولار(?:\s+أمريكي)?)/iu.test(value)) return "USD";
  if (/(?:SAR|ريال(?:\s+سعودي)?)/iu.test(value)) return "SAR";
  if (/(?:AED|درهم(?:\s+إماراتي)?)/iu.test(value)) return "AED";
  if (/(?:EGP|جنيه(?:\s+مصري)?)/iu.test(value)) return "EGP";
  return undefined;
}

function ordinals(text: string) {
  const found: number[] = [];
  const terms: Array<[RegExp, number]> = [
    [/(?:الأول|الاول|الأولى|الاولى|الأوليه|الاوليه|first)(?=\s|$|[،,.!?])/iu, 1],
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

function stateQueryTarget(text: string, state: NadimState, context?: NadimConversationContext): CurrentSearchQueryTarget | undefined {
  const asksValue = /(?:كام|كم|قد\s*(?:إيه|ايه)|إيش|ايش|وش|what|how\s+(?:much|many)|where)/iu.test(text);
  if (asksValue && /(?:ميزاني[هة]|budget|الحد\s*الأقصى|الحد\s*الاقصى|max(?:imum)?)/iu.test(text)) return "budgetMax";
  if (asksValue && /(?:غرف|غرفة|bedrooms?|rooms?)/iu.test(text)) return "bedrooms";
  if (/(?:فاكر|تفتكر).{0,24}(?:اخترت|اختارت|حددنا|وقفنا\s+على).{0,18}(?:أنهي|انهي|أي|اي|واحدة|وحدة|اختيار)|which\s+(?:one|option).{0,16}(?:did\s+I|we).{0,12}(?:choose|select)/iu.test(text)) return "SELECTED_RESULT";
  if (/(?:إحنا|احنا|حنا|we).{0,18}(?:بندور|ندور|looking).{0,12}(?:فين|وين|where)|(?:فين|وين|where).{0,15}(?:بندور|ندور|looking)/iu.test(text)) return "locations";
  if (/(?:فاكر|تفتكر).{0,28}(?:كنت\s+)?(?:بدور|بادور|طالب|عايز|وصلنا)|(?:إحنا|احنا|حنا)\s+كنا\s+بنتكلم\s+(?:في|عن)\s+(?:إيه|ايه|اي)|(?:آخر|اخر)\s+حاجة\s+وقفنا\s+عندها|(?:فاكر\s+)?وصلنا\s+لفين|(?:المواصفات|تفاصيل\s+البحث).{0,28}(?:إيه|ايه|إيش|ايش|وش|كام|كم)|طلبت\s+(?:إيه|ايه)|what.{0,18}(?:looking for|preferences)|summari[sz]e.{0,15}search|search\s+(?:details|preferences).{0,12}(?:what|which|are)|where\s+did\s+we\s+leave\s+off/iu.test(text)) return "SEARCH";
  if (state.search.budgetMax !== undefined && /(?:إحنا|احنا|حنا|we).{0,12}(?:وصلنا|at).{0,8}(?:ل)?(?:كام|كم|what)/iu.test(text)) return "budgetMax";
  const vaguePastPrice = /^(?:طب\s+)?(?:السعر|سعرها|سعره)\s+(?:كان\s+)?(?:كام|كم)[؟?!.،,\s]*$/iu.test(text);
  if (vaguePastPrice && state.search.budgetMax !== undefined) {
    const recent = context?.recentTurns.at(-1);
    const followsSearchMemory = recent?.intent === "CURRENT_SEARCH_QUERY" && recent.stateQuery === "SEARCH"
      || /(?:فاكر|كنا|وصلنا|بدور|المواصفات)/iu.test(recent?.user ?? "");
    if (!state.selectedUnitId || followsSearchMemory) return "budgetMax";
  }
  return undefined;
}

function responseGoal(intent: NadimUnderstanding["intent"], stateQuery?: CurrentSearchQueryTarget) {
  if (intent === "CURRENT_SEARCH_QUERY") return stateQuery === "SEARCH" ? "SUMMARIZE_CURRENT_SEARCH" : `ANSWER_CURRENT_${stateQuery ?? "SEARCH"}`;
  if (intent === "ASSISTANT_NATURE") return "EXPLAIN_AI_NATURE_TRANSPARENTLY";
  if (intent === "ASSISTANT_IDENTITY") return "ANSWER_ASSISTANT_IDENTITY";
  if (intent === "ASSISTANT_CAPABILITIES") return "EXPLAIN_REAL_ESTATE_SERVICE_CAPABILITIES";
  if (intent === "GREETING") return "RETURN_GREETING";
  if (intent === "SMALL_TALK") return "BRIEF_SMALL_TALK";
  if (intent === "CONVERSATION") return "RESPOND_HELPFULLY_TO_CONVERSATION";
  if (intent === "LANGUAGE_STYLE_CHANGE") return "CONFIRM_RESPONSE_STYLE";
  if (intent === "UNKNOWN") return "CLARIFY_UNCLEAR_MESSAGE";
  if (intent === "PROPERTY_SEARCH" || intent === "MODIFY_SEARCH") return "SEARCH_VERIFIED_INVENTORY";
  return intent;
}

function intentNeedsTool(intent: NadimUnderstanding["intent"]) {
  return [
    "PROPERTY_SEARCH", "MODIFY_SEARCH", "COMPARISON", "PROPERTY_QUESTION", "PRICE_QUESTION",
    "PAYMENT_PLAN_QUESTION", "MEDIA_REQUEST", "LOCATION_QUESTION", "AVAILABILITY_QUESTION",
  ].includes(intent);
}

function explicitUnderstanding(message: string, state: NadimState, context?: NadimConversationContext): NadimUnderstanding {
  const rawText = normalizedText(message);
  const text = withFrancoSemanticHints(rawText);
  const lower = text.toLowerCase();
  const operations: StateOperation[] = [];
  const activeSearch = hasActiveSearch(state);
  const modifyingSearch = /(?:خليها|خليه|خليهم|خلها|خلهم|زودها|زوّدها|نفس(?:ها|ه)?|نفس المواصفات|غي[ّ]?ر|عد[ّ]?ل|بدل|make it|make them|increase it|change|instead)/iu.test(text);
  const hasSearch = /(?:عايز|عاوز|أبي|ابي|أبغى|ابغى|ودي|بدور|دورلي|وريني|ابحث|find|show me|looking for|\bneed\b|search)/iu.test(text);
  const reset = /(?:ابد[أا]\s+(?:بحث|من جديد|من الأول|من الاول)|بحث جديد|نبدأ\s+من\s+(?:جديد|الأول|الاول)|سيب\s+اللي\s+فات|reset|new search|start over)/iu.test(text);
  const broadResetSearch = reset && /(?:امشي\s+(?:أي|اي)\s+حاجة|سيب\s+(?:كل\s+)?(?:الخيارات|المواصفات)\s+مفتوحة|anything|any(?:thing)?\s+(?:is\s+)?fine|search broadly)/iu.test(text);
  if (reset) operations.push({ operation: "RESET", field: "SEARCH" });

  const locations = LOCATION_TERMS.filter((term) => lower.includes(term.toLowerCase()));
  const openLocation = activeSearch && state.search.locations.length > 0
    && /(?:سيب|خلي|خل)\s+(?:المكان|الموقع)\s+(?:مفتوح|أي\s+مكان|اي\s+مكان)|(?:anywhere|any location|leave (?:the )?location open)/iu.test(text);
  const removeLocation = (locations.length > 0 && /(?:مش مهم|فكك من|شيل|الغي|الغى|انس|بدون|remove|not important)/iu.test(text)) || openLocation;
  const locationIsConstraint = hasSearch
    || modifyingSearch
    || /(?:شقة|فيلا|وحدة|مشروع|apartment|villa|unit|project)/iu.test(text);
  if (removeLocation) operations.push({ operation: "REMOVE", field: "locations" });
  else if (locations.length && locationIsConstraint) operations.push({ operation: "SET", field: "locations", value: locations.slice(0, 3) });

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
  const explicitMoneyBudget = text.match(/(?:معايا|معي|ميزانيتي|ميزانية|budget(?:\s+(?:is|max))?|لحد|تحت|up\s+to|under|خليها|خليه|زودها|زوّدها|make\s+it|increase\s+it)\s*(?:ل[ـ-]?\s*)?(\d[\d,.]*)\s*(ألف|الف|thousand|k|مليون|million|m)?\s*(USD|SAR|AED|EGP|دولار(?:\s+أمريكي)?|ريال(?:\s+سعودي)?|درهم(?:\s+إماراتي)?|جنيه(?:\s+مصري)?)/iu);
  const namedMillionBudget = explicitMoneyBudget ? undefined : text.match(/(?:معايا|معي|ميزانيتي|ميزانية|budget(?:\s+(?:is|max))?|لحد|تحت|up\s+to|under|خليها|خليه|زودها|زوّدها|make\s+it|increase\s+it)\s*(?:ل[ـ-]?\s*)?مليون\s*(USD|SAR|AED|EGP|دولار(?:\s+أمريكي)?|ريال(?:\s+سعودي)?|درهم(?:\s+إماراتي)?|جنيه(?:\s+مصري)?)/iu);
  if (explicitMoneyBudget) {
    const value = amount(explicitMoneyBudget[1], explicitMoneyBudget[2]);
    const currency = currencyCode(explicitMoneyBudget[3]);
    if (value !== undefined && currency) {
      for (let index = operations.length - 1; index >= 0; index -= 1) {
        if (["budgetMax", "currency"].includes(String(operations[index].field))) operations.splice(index, 1);
      }
      operations.push({ operation: "SET", field: "budgetMax", value }, { operation: "SET", field: "currency", value: currency });
    }
  } else if (namedMillionBudget) {
    const currency = currencyCode(namedMillionBudget[1]);
    if (currency) operations.push({ operation: "SET", field: "budgetMax", value: 1_000_000 }, { operation: "SET", field: "currency", value: currency });
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
  const inventoryCode = text.match(/\b(?=[\p{L}\d_/-]{3,60}\b)(?=[\p{L}\d_/-]*\p{L})(?=[\p{L}\d_/-]*\d)[\p{L}\d]+(?:[_/-][\p{L}\d]+)+\b/iu)?.[0];
  let unitReference = inventoryCode
    ?? text.match(/\b(?:unit|(?:ال)?وحدة)\s*[:#-]?\s*([\p{L}\d][\p{L}\d_\-/ ]{1,40})/iu)?.[1]?.trim();
  const resultSelection = references.length > 0 && state.lastResultIds.length > 0;
  const paymentPreferenceContext = hasSearch || (hasActiveSearch(state) && modifyingSearch);
  if (paymentPreferenceContext && /(?:تقسيط طويل|مدة أطول|مدة اطول|long(?:er)? installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "LONG_TERM" });
  } else if (paymentPreferenceContext && /(?:بالتقسيط|تقسيط|installments?)/iu.test(text)) {
    operations.push({ operation: "SET", field: "installmentPreference", value: "INSTALLMENTS" });
  }
  const hasMutation = operations.some((operation) => operation.operation !== "PRESERVE") && !reset;
  const discoveryOnlyMutation = hasMutation
    && operations.every((operation) => operation.operation === "PRESERVE" || operation.field === "purpose");
  const explicitSearchExecution = /(?:دورلي|وريني|ابحث|find|show me|search)/iu.test(text);
  const preserveRequest = activeSearch && /(?:لا\s+توس[ّ]?ع\s+(?:الخيارات|البحث)|خليك\s+على\s+نفس\s+المواصفات|نفس\s+المواصفات(?:\s*$)|keep\s+(?:it|the search)\s+(?:the )?same|don['’]?t\s+(?:widen|broaden|relax))/iu.test(text);
  if (preserveRequest) operations.unshift({ operation: "PRESERVE", field: "SEARCH" });
  const ambiguousRelativeChange = activeSearch
    && /(?:زودها|زوّدها|وسعها|وسّعها|increase it|raise it)\s+(?:شوية|شوي|a (?:bit|little))/iu.test(text)
    && !hasMutation;
  const queryTarget = stateQueryTarget(text, state, context);
  const paymentQuestion = /(?:(?:نظام|خطة|خطط)\s+(?:ال)?(?:دفع|سداد|تقسيط)|(?:الدفع|السداد)\s+(?:بتاع|ل(?:لوحدة)?|for)|المقدم\s+كام|التقسيط\s+على\s+كام\s*(?:سنة|سنين|شهر)?|payment plan|down payment|how (?:many|long).*(?:installment|year|month))/iu.test(text);
  if (!unitReference && paymentQuestion) {
    const pricedReference = text.match(/(?:بـ?|بسعر|price(?:d)?\s*(?:at)?)\s*(\d+(?:\.\d+)?)/iu)?.[1];
    const namedReference = text.match(/(?:بتاع|for)\s+([\p{L}\d][\p{L}\d ._/-]{1,80}?)(?:[؟?!.،,]|$)/iu)?.[1]?.trim();
    const genericReference = namedReference && /^(?:(?:ال)?وحدة\s+(?:دي|ديت|هذه)|it|this\s+unit)$/iu.test(namedReference);
    unitReference = pricedReference ?? (genericReference ? undefined : namedReference);
  }
  const addressOnlyRequest = state.languageStyle?.grammaticalAddressChangedThisTurn
    && /(?:صيغة|خاطبني|مؤنث|مذكر|محايد|address me|feminine|masculine|gender[- ]neutral)/iu.test(text);
  const languageOnly = Boolean(state.languageStyle?.explicitRequestThisTurn || addressOnlyRequest)
    && !hasMutation
    && !/(?:شقة|فيلا|وحدة|مشروع|سعر|ميزانية|تقسيط|مقدم|غرف|حمام|مساحة|متاح|صور|معاينة|حجز|apartment|villa|unit|project|price|budget|payment|bedroom|bathroom|area|available|media|viewing|reservation)/iu.test(text);
  const mediaRequest = /(?:وريني|ابعت(?:لي)?|هات|عايز|عاوز|أبي|ابي|أبغى|ابغى|فيه?|هل\s+في|show(?:\s+me)?|send(?:\s+me)?|are\s+there).{0,28}(?:الصور|الصورة|صور|صورة|ماستر\s*بلان|floor\s*plan|master\s*plan|photos?|images?|media)|^(?:صور|صورة|photos?|images?|media)[؟?!.،,\s]*$/iu.test(text);
  const proximityRequest = /(?:أقرب|الاقرب|الأقرب|أبعد|الابعد|الأبعد|مسافة|وقت\s+الطريق|closer|nearest|farther|distance|travel\s*time)/iu.test(text);
  let intent: NadimUnderstanding["intent"] = "UNKNOWN";
  if (/^(?:اهلا|أهلا|أهلين|هلا|السلام عليكم|صباح الخير|مساء الخير|hi|hello|hey)(?=\s|$|[،,.!?])/iu.test(text)) intent = "GREETING";
  if (hasSearch && (hasMutation || explicitSearchExecution)) intent = "PROPERTY_SEARCH";
  else if (hasSearch) intent = "CONVERSATION";
  else if (hasMutation) intent = activeSearch ? "MODIFY_SEARCH" : discoveryOnlyMutation ? "CONVERSATION" : "PROPERTY_SEARCH";
  if (reset) intent = broadResetSearch ? "PROPERTY_SEARCH" : "RESET_SEARCH";
  if (/(?:قارن|مقارنة|compare)/iu.test(text) || (proximityRequest && state.comparisonUnitIds.length >= 2)) intent = "COMPARISON";
  else if (mediaRequest) intent = "MEDIA_REQUEST";
  else if (paymentQuestion && !["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent)) intent = "PAYMENT_PLAN_QUESTION";
  else if (/(?:السعر|سعرها|سعره|price|how much)/iu.test(text)) intent = "PRICE_QUESTION";
  else if (/(?:متاح|متاحة|availability|available)/iu.test(text) && !["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent)) intent = "AVAILABILITY_QUESTION";
  else if (/(?:الموقع|فين|location|where is)/iu.test(text) && !hasSearch) intent = "LOCATION_QUESTION";
  if (resultSelection && ["UNKNOWN", "PROPERTY_SEARCH"].includes(intent)) intent = "PROPERTY_QUESTION";
  if (/(?:احجز|حجز|reservation|reserve)/iu.test(text)) intent = "RESERVATION_REQUEST";
  else if (/(?:معاينة|viewing|visit)/iu.test(text)) intent = "VIEWING_REQUEST";
  else if (/(?:مش\s+عايز\s+أكمل\s+مع\s+(?:ال)?(?:ai|ذكاء)|عايز\s+(?:أكلم|اتكلم\s+مع)\s+حد|(?:عايز|عاوز).{0,12}حد.{0,24}(?:خدمة\s+العملاء|الفريق|المبيعات)|موظف|حد من المبيعات|human|sales agent|representative|talk to (?:a )?(?:person|human))/iu.test(text)) intent = "HUMAN_HANDOFF";
  else if (!languageOnly && /(?:كلمني|اتصل بي|اتصلوا|callback|call me)/iu.test(text)) intent = "CALLBACK_REQUEST";
  else if (/(?:سيب بياناتي|مهتم|contact me|lead)/iu.test(text)) intent = "LEAD_REQUEST";
  if (/(?:اسمك\s*(?:إيه|ايه|اي)?|إنت\s+مين|انت\s+مين|مين\s+نديم|what(?:'s| is)\s+your\s+name|who\s+are\s+you)/iu.test(text)) intent = "ASSISTANT_IDENTITY";
  else if (/(?:إنت|انت|نديم).{0,22}(?:إنسان|انسان|بني\s+آدم|بني\s+ادم|روبوت|ذكاء\s+اصطناعي)|(?:مو|مش|مش\s+كدا|مش\s+كده)\s+(?:إنسان|انسان)|(?:are|aren['’]?t)\s+you\s+(?:a\s+)?(?:human|robot|bot|ai)|so\s+you(?:'re|\s+are)\s+not\s+human/iu.test(text)) intent = "ASSISTANT_NATURE";
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
  const vaguePriceReference = /^(?:طب\s+)?(?:السعر|سعرها|سعره)\s+(?:كان\s+)?(?:كام|كم)[؟?!.،,\s]*$/iu.test(text);
  const priceReferenceAmbiguous = vaguePriceReference
    && !queryTarget
    && state.selectedUnitId !== undefined
    && state.search.budgetMax !== undefined;
  const unintelligible = looksLikeGibberish(rawText);
  if (unintelligible) intent = "UNKNOWN";

  const ordinalUnavailable = references.length > 0 && state.lastResultIds.length === 0;
  const ambiguity = ambiguousRelativeChange
    ? "SEARCH_CHANGE_AMOUNT_REQUIRED"
    : priceReferenceAmbiguous ? "PRICE_REFERENCE_AMBIGUOUS" : undefined;
  const deterministicReferences: NonNullable<NadimUnderstanding["references"]> = [];
  if (queryTarget === "budgetMax" && vaguePriceReference) {
    deterministicReferences.push({ expression: "السعر", resolvedAs: "SEARCH_BUDGET", confidence: 0.9 });
  } else if (queryTarget === "SEARCH") {
    deterministicReferences.push({ expression: "conversation memory", resolvedAs: "ACTIVE_SEARCH", confidence: 0.95 });
  }
  for (const reference of references) {
    deterministicReferences.push({
      expression: `ordinal:${reference}`,
      resolvedAs: state.lastResultIds[reference - 1] ? "RECENT_RESULT" : "UNRESOLVED",
      confidence: state.lastResultIds[reference - 1] ? 0.92 : 0.55,
    });
  }

  const followUpTemporal = extractFollowUpTemporalRequest(rawText);
  const explicitFollowUp = Boolean(followUpTemporal && /(?:تابع|كلمني|ارجع|فكرني|حدد|حدّد|معاد|موعد|اتصل|follow\s*up|call\s+me|remind\s+me|get\s+back|schedule)/iu.test(text));
  const shareRequest = /(?:(?:هات|ابعت|اديني|عايز|عاوز).{0,18})?(?:رابط|لينك).{0,18}(?:المحادثة|الويب)|(?:conversation|web)\s+(?:link|url)|(?:أكمل|اكمل|continue).{0,20}(?:الويب|web)/iu.test(text);
  const whatsappHandoff = /(?:(?:أكمل|اكمل|افتح|انقل|حوّل|حول|continue|open|move).{0,40}(?:المحادثة|الشات|chat|conversation)?\s*(?:دي|هذه|this)?\s*.{0,16}(?:واتس(?:اب)?|whatsapp))|(?:(?:هات|ابعت|اديني|عايز|عاوز|أبي|ابي|give|send).{0,24}(?:رابط|لينك|link).{0,18}(?:واتس(?:اب)?|whatsapp))/iu.test(text);
  const deleteRequest = /(?:امسح|احذف|حذف|delete|erase).{0,20}(?:المحادثة|الشات|conversation|chat)/iu.test(text);
  const deletionPending = Boolean(context?.pendingDeletion?.expiresAt && Date.parse(context.pendingDeletion.expiresAt) > Date.now());
  const deleteConfirmation = deletionPending && /^(?:أيوه|ايوه|نعم|أكيد|اكد|أكد|yes|confirm)(?:\s+(?:امسحها|احذفها|delete\s+it))?[.!،,\s]*$/iu.test(text);
  const deterministicActions: NonNullable<NadimUnderstanding["proposedActions"]> = [
    ...(explicitFollowUp ? [{ type: "CREATE_FOLLOWUP", reason: "Customer explicitly requested a future follow-up", payload: { temporal: followUpTemporal, sourceText: rawText.slice(0, 500) } }] : []),
    ...(shareRequest ? [{ type: "CREATE_CONVERSATION_SHARE_LINK", reason: "Customer requested a secure Web conversation link", payload: {} }] : []),
    ...(whatsappHandoff ? [{ type: "CREATE_WHATSAPP_HANDOFF_LINK", reason: "Customer requested WhatsApp continuation", payload: {} }] : []),
    ...(deleteConfirmation ? [{ type: "CONFIRM_CONVERSATION_DELETION", reason: "Customer confirmed a pending deletion", payload: {} }] : deleteRequest ? [{ type: "REQUEST_CONVERSATION_DELETION", reason: "Customer requested conversation deletion", payload: {} }] : []),
  ];
  const understood = intent !== "UNKNOWN" || deterministicActions.length > 0;
  const classificationSource = unintelligible ? "DETERMINISTIC_GIBBERISH" : "DETERMINISTIC_EXPLICIT";
  return {
    intent,
    confidence: unintelligible ? 0.95 : intent === "UNKNOWN" ? 0.35 : 0.9,
    locale: /[\u0600-\u06FF]/u.test(rawText) ? "ar-EG" : "en",
    operations: unintelligible ? [] : operations,
    ordinalReferences: references,
    unitReference,
    actionRequested: deterministicActions.length > 0 || ["LEAD_REQUEST", "CALLBACK_REQUEST", "VIEWING_REQUEST", "RESERVATION_REQUEST", "HUMAN_HANDOFF"].includes(intent),
    proposedActions: deterministicActions.length ? deterministicActions : undefined,
    stateQuery: queryTarget,
    ambiguity,
    responseGoal: responseGoal(intent, queryTarget),
    references: deterministicReferences,
    needsTool: intentNeedsTool(intent) && !ambiguity && !ordinalUnavailable,
    needsClarification: Boolean(ambiguity || ordinalUnavailable || unintelligible),
    clarificationReason: ambiguity ?? (ordinalUnavailable ? "RESULT_LIST_EMPTY" : unintelligible ? "UNINTELLIGIBLE" : undefined),
    understoodMeaning: intent === "CONVERSATION" && hasSearch ? "The customer is expressing broad property interest and needs guided discovery." : undefined,
    recentContextUsed: Boolean(context?.recentTurns.length && (queryTarget || references.length || modifyingSearch)),
    understood,
    conversationalType: intent === "CONVERSATION" ? "DISCOVERY" : intent === "UNKNOWN" ? "CLARIFICATION" : "STRUCTURED_REQUEST",
    classificationSource,
    unknownReason: intent === "UNKNOWN" ? (unintelligible ? "GIBBERISH_OR_CORRUPTION" : "NO_EXPLICIT_DETERMINISTIC_MATCH") : undefined,
  };
}

function semanticFallback(
  deterministic: NadimUnderstanding,
  message: string,
  reason: string,
  source: NadimUnderstanding["classificationSource"] = "DETERMINISTIC_SAFE_FALLBACK",
): NadimUnderstanding {
  if (deterministic.intent !== "UNKNOWN" || deterministic.actionRequested || !looksLikeNaturalConversation(message)) {
    return { ...deterministic, classificationSource: source, unknownReason: deterministic.intent === "UNKNOWN" ? reason : undefined };
  }
  return {
    ...deterministic,
    intent: "CONVERSATION",
    confidence: 0.5,
    operations: [],
    ordinalReferences: [],
    actionRequested: false,
    ambiguity: undefined,
    responseGoal: "CONTINUE_CONVERSATION_SAFELY",
    references: [],
    needsTool: false,
    needsClarification: false,
    clarificationReason: undefined,
    understoodMeaning: "Natural-language conversation; semantic model interpretation was unavailable.",
    recentContextUsed: false,
    understood: true,
    conversationalType: "CONVERSATION",
    classificationSource: source,
    unknownReason: reason,
  };
}

function semanticIntent(semantic: NadimSemanticInterpretation): NadimUnderstanding["intent"] {
  if (!semantic.understood) return "UNKNOWN";
  if (!semantic.proposedIntent || semantic.proposedIntent === "UNKNOWN") return "CONVERSATION";
  return semantic.proposedIntent;
}

@Injectable()
export class UnderstandingService {
  constructor(private readonly dialogue: DialogueModelService) {}

  async understand(
    message: string,
    state: NadimState,
    trace: { conversationId?: string; requestId?: string } = {},
    context?: NadimConversationContext,
  ): Promise<UnderstandingResult> {
    const dialogue = this.dialogue as DialogueModelService & {
      decide?: DialogueModelService["decide"];
    };
    if (this.dialogue.available() && typeof dialogue.decide === "function") {
      try {
        const result = await dialogue.decide(message, state, context, trace);
        const decision = result.value;
        const deterministic = explicitUnderstanding(message, state, context);
        const proposedActions = [...decision.proposedActions];
        for (const action of deterministic.proposedActions ?? []) {
          if (!proposedActions.some((candidate) => candidate.type === action.type)) proposedActions.push(action as typeof proposedActions[number]);
        }
        const operationsAllowed = decision.understood
          && decision.confidence >= 0.72
          && ["DISCOVERY", "STRUCTURED_REQUEST"].includes(decision.conversationalType);
        const explicitIntentWins = ["PROPERTY_SEARCH", "MODIFY_SEARCH", "MEDIA_REQUEST", "COMPARISON", "PRICE_QUESTION", "PAYMENT_PLAN_QUESTION", "AVAILABILITY_QUESTION", "LOCATION_QUESTION", "HUMAN_HANDOFF", "ASSISTANT_IDENTITY", "ASSISTANT_NATURE"].includes(deterministic.intent);
        const intent = explicitIntentWins
          ? deterministic.intent
          : !decision.understood
          ? "UNKNOWN"
          : decision.intent && decision.intent !== "UNKNOWN" ? decision.intent : "CONVERSATION";
        const stateQueries = decision.stateQueries;
        const stateQuery = stateQueries[0];
        const equivalent = (left: StateOperation, right: StateOperation) => left.operation === right.operation
          && left.field === right.field
          && JSON.stringify(left.value)?.toLocaleLowerCase() === JSON.stringify(right.value)?.toLocaleLowerCase();
        const deterministicFields = new Set(deterministic.operations
          .filter((operation) => !decision.proposedStateOperations.some((candidate) => equivalent(operation, candidate)))
          .map((operation) => operation.field));
        const deterministicAdditions = deterministic.operations.filter((operation) => !decision.proposedStateOperations.some((candidate) => equivalent(operation, candidate)));
        const operations = stateQueries.length
          ? decision.proposedStateOperations.filter((operation) => operation.operation === "PRESERVE")
          : [
              ...(operationsAllowed ? decision.proposedStateOperations.filter((operation) => !deterministicFields.has(operation.field)) : []),
              ...deterministicAdditions,
            ];
        const proposedToolCalls = deterministic.intent === "MEDIA_REQUEST"
          ? decision.proposedToolCalls.filter((call) => call.tool === "GET_MEDIA" || (call.tool === "GET_LOCATION" && /(?:اللوكيشن|الموقع|location|map)/iu.test(message)))
          : decision.proposedToolCalls;
        const understanding: NadimUnderstanding = {
          intent,
          confidence: decision.confidence,
          locale: decision.locale ?? undefined,
          operations,
          ordinalReferences: deterministic.ordinalReferences,
          unitReference: this.referenceArgument(decision, "unitReference"),
          projectReference: this.referenceArgument(decision, "projectReference"),
          actionRequested: deterministic.actionRequested,
          stateQuery,
          responseGoal: decision.conversationalGoal,
          responsePlan: decision.responsePlan,
          references: decision.references,
          needsTool: decision.proposedToolCalls.length > 0,
          needsClarification: decision.needsClarification,
          clarificationReason: decision.clarificationReason ?? undefined,
          understoodMeaning: decision.understoodMeaning,
          recentContextUsed: decision.recentContextUsed,
          understood: decision.understood,
          conversationalType: decision.conversationalType,
          classificationSource: decision.intent ? "MODEL_STRUCTURED" : "MODEL_SEMANTIC",
          unknownReason: decision.understood ? undefined : decision.clarificationReason ?? "MODEL_COULD_NOT_INTERPRET",
          proposedToolCalls: proposedToolCalls.length ? proposedToolCalls : ["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(intent) ? undefined : [],
          proposedActions,
          customerContextUpdates: Object.fromEntries(Object.entries(decision.customerContextUpdates)
            .filter(([key]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key))
            .slice(0, 20)),
          stateQueries,
          responseStyleRequest: decision.responseStyleRequest,
        };
        return {
          understanding,
          brainDecision: decision,
          model: { provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, latencyMs: result.latencyMs, fallbackStage: result.fallbackStage },
          providerLatencyMs: result.latencyMs + result.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
          providerErrorCategory: result.attempts.at(-1)?.errorCategory,
        };
      } catch (error) {
        const deterministic = explicitUnderstanding(message, state, context);
        const category = error instanceof DialogueProviderChainError
          ? error.attempts.at(-1)?.errorCategory ?? "PROVIDER_CHAIN_FAILED"
          : "BRAIN_DECISION_FAILED";
        const latency = error instanceof DialogueProviderChainError
          ? error.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0)
          : 0;
        return {
          understanding: semanticFallback(deterministic, message, "PRIMARY_BRAIN_UNAVAILABLE"),
          providerErrorCategory: category,
          providerLatencyMs: latency,
        };
      }
    }
    // The scenario-oriented interpreter is now isolated to explicit outage and
    // rollback compatibility. It never competes with a healthy AI decision.
    const deterministic = explicitUnderstanding(message, state, context);
    if (!this.dialogue.available()) {
      return { understanding: semanticFallback(deterministic, message, "SEMANTIC_MODEL_UNAVAILABLE"), providerErrorCategory: "NOT_CONFIGURED", providerLatencyMs: 0 };
    }
    if (deterministic.intent === "UNKNOWN" && deterministic.confidence >= 0.8) return { understanding: deterministic };
    if (deterministic.confidence >= 0.8 && [
      "GREETING", "ASSISTANT_IDENTITY", "ASSISTANT_NATURE", "ASSISTANT_CAPABILITIES",
      "LANGUAGE_CAPABILITY_QUERY", "SMALL_TALK",
    ].includes(deterministic.intent)) {
      return { understanding: deterministic };
    }
    if (deterministic.intent === "LANGUAGE_STYLE_CHANGE"
      || (deterministic.intent === "SMALL_TALK" && state.languageStyle.grammaticalAddressChangedThisTurn)) {
      return { understanding: deterministic };
    }
    try {
      const result = await this.dialogue.understand(message, state, context, trace);
      const parsed = NadimSemanticInterpretationSchema.safeParse(result.value);
      const model = { provider: result.provider, model: result.model, fallbackUsed: result.fallbackUsed, latencyMs: result.latencyMs };
      if (!parsed.success) {
        return { understanding: semanticFallback(deterministic, message, "INVALID_SEMANTIC_INTERPRETATION", "MODEL_REJECTED"), model };
      }
      const semantic = parsed.data;
      const explicitFields = new Set(deterministic.operations.map((operation) => operation.field));
      const modelOperationsAllowed = semantic.understood
        && semantic.confidence >= 0.75
        && ["DISCOVERY", "STRUCTURED_REQUEST"].includes(semantic.conversationalType);
      let mergedOperations = [
        ...(modelOperationsAllowed ? semantic.proposedStateOperations.filter((operation) => !explicitFields.has(operation.field)) : []),
        ...deterministic.operations,
      ];
      const modelCanResolveContext = Boolean(context?.recentTurns.length)
        && semantic.confidence >= 0.75
        && (semantic.recentContextUsed || semantic.references.length > 0 || semantic.proposedIntent === "CURRENT_SEARCH_QUERY");
      const contextSensitiveIntent = ["UNKNOWN", "PRICE_QUESTION", "PROPERTY_QUESTION"].includes(deterministic.intent);
      const proposedIntent = semanticIntent(semantic);
      const semanticCorrectsConversationalFalsePositive = proposedIntent === "CONVERSATION"
        && semantic.confidence >= 0.85
        && deterministic.operations.length === 0
        && !deterministic.actionRequested
        && ["CONVERSATION", "DISCOVERY", "REACTION", "ACKNOWLEDGEMENT"].includes(semantic.conversationalType);
      let intent = deterministic.confidence >= 0.8 && !(contextSensitiveIntent && modelCanResolveContext)
        ? deterministic.intent
        : proposedIntent;
      if (semanticCorrectsConversationalFalsePositive) intent = "CONVERSATION";
      if (deterministic.intent === "CONVERSATION" && semantic.understood) intent = proposedIntent;
      const stateQuery = deterministic.stateQuery ?? semantic.stateQuery ?? undefined;
      const modelRecoveryIsWeak = deterministic.intent === "UNKNOWN"
        && proposedIntent !== "UNKNOWN"
        && semantic.confidence < 0.7;
      const modelSearchHasNoMeaning = ["UNKNOWN", "CONVERSATION"].includes(deterministic.intent)
        && ["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(proposedIntent)
        && deterministic.operations.length === 0
        && semantic.proposedStateOperations.length === 0
        && !semantic.clarification.required;
      const modelStateQueryHasNoTarget = proposedIntent === "CURRENT_SEARCH_QUERY" && !stateQuery;
      if (modelRecoveryIsWeak || modelSearchHasNoMeaning || modelStateQueryHasNoTarget) intent = "CONVERSATION";
      if (!semantic.understood) intent = "UNKNOWN";
      if ([
        "GREETING", "ASSISTANT_IDENTITY", "ASSISTANT_NATURE", "ASSISTANT_CAPABILITIES", "LANGUAGE_CAPABILITY_QUERY",
        "LANGUAGE_STYLE_CHANGE", "CURRENT_SEARCH_QUERY", "CORRECTION", "SMALL_TALK", "UNKNOWN",
      ].includes(intent)) {
        mergedOperations = deterministic.operations.filter((operation) => operation.operation === "PRESERVE");
      }
      const semanticClarification = semantic.clarification.required ? semantic.clarification.reason ?? "SEMANTIC_CLARIFICATION_REQUIRED" : undefined;
      const ambiguity = deterministic.ambiguity ?? (intent === "UNKNOWN" ? undefined : semanticClarification);
      const references = deterministic.references?.length ? deterministic.references : semantic.references;
      const selectedSemanticIntent = intent === proposedIntent || (intent === "CONVERSATION" && proposedIntent === "UNKNOWN");
      const deterministicSelected = intent === deterministic.intent
        && deterministic.confidence >= 0.8
        && !semanticCorrectsConversationalFalsePositive
        && !(contextSensitiveIntent && modelCanResolveContext);
      const understanding: NadimUnderstanding = {
        intent,
        confidence: Math.max(semantic.confidence, deterministic.confidence),
        locale: deterministic.locale ?? semantic.locale ?? undefined,
        operations: mergedOperations,
        ordinalReferences: deterministic.ordinalReferences.length ? deterministic.ordinalReferences : semantic.ordinalReferences,
        unitReference: deterministic.unitReference ?? semantic.unitReference ?? undefined,
        projectReference: semantic.projectReference ?? undefined,
        stateQuery,
        ambiguity,
        responseGoal: selectedSemanticIntent ? semantic.responseGoal : responseGoal(intent, stateQuery),
        references,
        needsTool: intentNeedsTool(intent) && !ambiguity,
        needsClarification: Boolean(ambiguity || (intent === "UNKNOWN" && semantic.clarification.required)),
        clarificationReason: ambiguity ?? (semantic.clarification.required ? semantic.clarification.reason ?? undefined : undefined),
        recentContextUsed: Boolean(deterministic.recentContextUsed || semantic.recentContextUsed),
        understoodMeaning: semantic.understoodMeaning,
        understood: semantic.understood,
        conversationalType: semantic.conversationalType,
        classificationSource: deterministicSelected
          ? "DETERMINISTIC_EXPLICIT"
          : intent === "CONVERSATION" || intent === "UNKNOWN" ? "MODEL_SEMANTIC" : "MODEL_STRUCTURED",
        unknownReason: intent === "UNKNOWN" ? semantic.clarification.reason ?? "MODEL_COULD_NOT_INTERPRET" : undefined,
        // Model output may propose an action-shaped intent, but it cannot grant
        // execution authority. Only explicit deterministic language does that.
        actionRequested: deterministic.actionRequested,
      };
      return { understanding, model };
    } catch {
      return { understanding: semanticFallback(deterministic, message, "SEMANTIC_MODEL_CALL_FAILED") };
    }
  }

  private referenceArgument(decision: NadimBrainDecision, key: "unitReference" | "projectReference") {
    for (const call of decision.proposedToolCalls) {
      const value = call.arguments[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 200);
    }
    return undefined;
  }
}
