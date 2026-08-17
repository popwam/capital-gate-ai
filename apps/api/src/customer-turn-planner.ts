import { CustomerTurnIntent, PresentationState, StructuredIntent } from "./providers/ai-provider";

export type UIActionType = "PROPERTY_CARDS" | "PROJECT_PHOTOS" | "PROJECT_BROCHURE" | "PROJECT_LOCATION" | "DISTANCE_RESULT" | "VIEWING_REQUEST" | "CONTACT_REQUEST";
export type UIAction = { type: UIActionType; payload: Record<string, unknown> };
export type TurnPlan = {
  intent: CustomerTurnIntent;
  requiresDatabase: boolean;
  requiresExtraction: boolean;
  deterministicResponse?: string;
  emitCards: boolean;
  executeBrochure: boolean;
  exactUnitId?: string;
  widenSearch?: boolean;
};

const normalize = (value: string) => value.toLowerCase().normalize("NFKC").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
const affirmative = /^(?:(?:اه|ايوه|أيوه|تمام|ماشي|yes|yeah|yep|sure|ok|okay)(?:\s+(?:وريني|ابعت|ابعته))?|ابعت|ابعته|وريني(?:\s+كده)?)$/iu;

export function exactExternalUnitId(source: string) {
  const strict = source.match(/(?:unit|الوحده|الوحدة|وحده|وحدة)?\s*([a-z][a-z0-9-]*\s+\d+\s*\/\s*\d+)\b/iu)?.[1];
  if (strict) return strict.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();

  const labeled = source.match(/(?:unit|الوحده|الوحدة|وحده|وحدة)\s*[:#-]?\s*([a-z0-9][a-z0-9_-]*(?:\s+\d+\s*\/\s*\d+)?)/iu)?.[1];
  const normalized = labeled?.replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  if (!normalized || /^(?:دي|ده|دا|this|that)$/iu.test(normalized)) return undefined;
  return normalized;
}

export function planCustomerTurn(source: string, previous: StructuredIntent): TurnPlan {
  const text = normalize(source);
  const unitId = exactExternalUnitId(source);
  const offered = previous.presentation?.awaitingConfirmation ? previous.presentation.lastOfferedAction : undefined;

  if (affirmative.test(text) && offered) {
    return {
      intent: "FOLLOW_UP_CONFIRMATION",
      requiresDatabase: true,
      requiresExtraction: false,
      emitCards: offered === "PROPERTY_CARDS",
      executeBrochure: offered === "PROJECT_BROCHURE",
      widenSearch: offered === "SEARCH_WIDEN",
    };
  }

  if (/(?:عاوز|عايز|محتاج).*(?:احجز|اعاين)|(?:احجز|حجز|معاينه)|book\s+(?:a\s+)?viewing|request\s+viewing|viewing\s+for/iu.test(text))
    return { intent: "VIEWING_REQUEST", requiresDatabase: true, requiresExtraction: false, emitCards: true, executeBrochure: false, exactUnitId: unitId };

  if (/(?:وريني|هات|اعرض|ابعت).*(?:الصور|صور)|(?:photos?|images?)\b/iu.test(text))
    return { intent: "MEDIA_REQUEST", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false, exactUnitId: unitId };

  if (/(?:بروشور|brochure|pdf\s+(?:المشروع|project))/iu.test(text))
    return { intent: "BROCHURE_REQUEST", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: /(?:ابعت|ابعته|هات|نزل|download|send|show)/iu.test(text) };

  if (/(?:بعيد كام|المسافه|كام\s*(?:كيلو|كم|دقيقه)|بينه\s+وبين|بينها\s+وبين|how far|distance|route duration)/iu.test(text))
    return { intent: "DISTANCE_REQUEST", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:فين\s+(?:المشروع|مكان)|المشروع\s+فين|الموقع|لوكيشن|project location|where is)/iu.test(text))
    return { intent: "LOCATION_REQUEST", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:تعرف|عندك|المتاح|الموجود).*(?:مطورين|المطورين|developers?)|(?:ايه|اي|what)\s+(?:المطورين|developers?)/iu.test(text))
    return { intent: "INVENTORY_AGGREGATION", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:تعرف|عندك|المتاح|الموجود).*(?:مشاريع|المشاريع|projects?)|(?:ايه|اي|what)\s+(?:المشاريع|projects?)/iu.test(text))
    return { intent: "INVENTORY_AGGREGATION", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:انواع\s+الوحدات|أنواع\s+الوحدات|unit types?)/iu.test(text) && /(?:ايه|اي|متاح|موجود|عندك|what|available)/iu.test(text))
    return { intent: "INVENTORY_AGGREGATION", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:كام\s+(?:عدد\s+)?الوحدات|عدد\s+الوحدات|عندك\s+كام\s+واحده|how many units|unit count)/iu.test(text))
    return { intent: "INVENTORY_COUNT", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:المساحات|مساحات|area range|available areas)/iu.test(text))
    return { intent: "AREA_AGGREGATION", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:الاسعار|أسعار|price range|available prices)/iu.test(text))
    return { intent: "PRICE_AGGREGATION", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:مشروع\s*(?:اي|ايه)\s*(?:ده|دا|دي)?|اسم\s+المشروع|المشروع\s*(?:اي|ايه)|which\s+project|project\s+name)/iu.test(text))
    return { intent: "PROJECT_DETAILS", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:مين\s+المطور|المطور\s*(?:اي|ايه|مين)|اسم\s+المطور|who\s+is\s+(?:the\s+)?developer|developer\s+name|which\s+developer)/iu.test(text))
    return { intent: "DEVELOPER_DETAILS", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (unitId && /(?:وريني|اعرض|show|details?|تفاصيل)/iu.test(text))
    return { intent: "PROPERTY_DETAILS", requiresDatabase: true, requiresExtraction: false, emitCards: true, executeBrochure: false, exactUnitId: unitId };

  if (!unitId && /(?:وريني|اعرض|show).*(?:الوحده|الوحدة|unit)\b/iu.test(text))
    return { intent: "PROPERTY_DETAILS", requiresDatabase: true, requiresExtraction: false, emitCards: true, executeBrochure: false };

  if (/(?:وريني|اعرضلي|اعرض|هات|ابعت).*(?:الوحدات|الاختيارات|الخيارات)|show me (?:the )?(?:units|options)/iu.test(text))
    return { intent: "PROPERTY_OPTIONS_REQUEST", requiresDatabase: true, requiresExtraction: true, emitCards: true, executeBrochure: false };

  if (/(?:قارن|مقارنه|compare|comparison|انهي احسن)/iu.test(text))
    return { intent: "COMPARISON", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (/(?:نظام\s+السداد|خطه\s+السداد|خطة\s+السداد|تقسيط|قسط|مقدم|payment plan|installments?)/iu.test(text))
    return { intent: "PAYMENT_PLAN", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false, exactUnitId: unitId };

  if (/(?:متاحه|متاح|availability|available).*(?:وحده|unit)|(?:في|هل).*(?:وحده|unit).*(?:اقل|أقل|under)/iu.test(text))
    return { intent: "AVAILABILITY_CHECK", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (/(?:استثمار|investment|عائد)/iu.test(text))
    return { intent: "INVESTMENT", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (/(?:اعاده\s+البيع|resale)/iu.test(text))
    return { intent: "RESALE", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (/(?:ايجار|rental|rent|yield)/iu.test(text))
    return { intent: "RENTAL", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (/(?:كلمني|تواصل|contact me|call me|sales advisor)/iu.test(text))
    return { intent: "CONTACT_REQUEST", requiresDatabase: false, requiresExtraction: true, emitCards: false, executeBrochure: false };

  if (unitId)
    return { intent: "PROPERTY_DETAILS", requiresDatabase: true, requiresExtraction: false, emitCards: false, executeBrochure: false, exactUnitId: unitId };

  if (/(?:تقدر|ممكن|بتقدر|يمكنك).*(?:تسا+ع+دني|تساعدني|تساعد|تعمل|تقدم)|(?:تسا+ع+دني|تساعدني|تساعدنى)\s*(?:ب|في)?\s*(?:اي|إيه|ايه)|(?:what can you do|how can you help|can you help me)/iu.test(text))
    return { intent: "SMALL_TALK", requiresDatabase: false, requiresExtraction: false, emitCards: false, executeBrochure: false, deterministicResponse: /[\u0600-\u06ff]/u.test(source) ? "أقدر أساعدك تدور على وحدة مناسبة، تقارن بين المشاريع والمراحل، تعرف الأسعار وخطط السداد، تراجع فرص الاستثمار أو إعادة البيع والإيجار، وتحسب المسافات من الخريطة ببيانات فعلية. قولّي المنطقة أو الميزانية أو اسم المشروع ونبدأ." : "I can help you find units, compare projects and phases, review prices and payment plans, assess investment/resale/rental options, and calculate real map routes. Tell me an area, budget, or project name to start." };

  if (/^(?:مساء|صباح)\s+(?:الفل|الخير|النور)|^(?:اهلا|أهلا|هاي|هلا|hello|hi|hey|عامل ايه)[!.؟?\s]*$/iu.test(text))
    return { intent: "SMALL_TALK", requiresDatabase: false, requiresExtraction: false, emitCards: false, executeBrochure: false };

  if (/(?:المطور|developer|track record|سابقة اعمال)/iu.test(text))
    return { intent: "DEVELOPER_DETAILS", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };

  return { intent: previous.presentation?.searchCandidateIds?.length ? "PROPERTY_REFINEMENT" : "PROPERTY_SEARCH", requiresDatabase: true, requiresExtraction: true, emitCards: false, executeBrochure: false };
}

function money(value: string) { const n = Number(value.replace(",", ".")); return n * 1_000_000; }

export function applyDeterministicTurnSemantics(source: string, extracted: StructuredIntent, previous: StructuredIntent, plan: TurnPlan): StructuredIntent {
  const text = normalize(source);
  const next: StructuredIntent = { ...extracted, turnIntent: plan.intent, presentation: previous.presentation ?? {} };

  if (plan.exactUnitId) {
    next.externalUnitId = plan.exactUnitId;
    next.bedrooms = previous.bedrooms;
    next.bathrooms = previous.bathrooms;
  }

  if (plan.intent === "VIEWING_REQUEST") next.purchaseIntent = Math.max(next.purchaseIntent ?? 0, 90);
  if (plan.intent === "CONTACT_REQUEST") next.purchaseIntent = Math.max(next.purchaseIntent ?? 0, 85);

  const around = text.match(/(?:في\s+حدود|حوالي|around|about)\s*(\d+(?:[.,]\d+)?)\s*(?:مليون|m|mn|million)/iu);
  const strict = text.match(/(?:لا\s+)?(?:عاوزها|عايزها|عاوز|عايز)\s*(\d+(?:[.,]\d+)?)\s*(?:مليون|m|mn|million)?/iu);
  const under = text.match(/(?:اقل|أقل|تحت|under|less than)\s*(?:من\s*)?(\d+(?:[.,]\d+)?)\s*(?:مليون|m|mn|million)?/iu);
  const rejected = text.match(/(?:بس\s+)?مش\s*(\d+(?:[.,]\d+)?)\s*(?:مليون|m|mn|million)?/iu);

  if (around) {
    const target = money(around[1]);
    next.priceTarget = target;
    next.priceMax = Math.round(target * 1.05);
    next.budgetMax = next.priceMax;
    next.budgetFlexibility = /(?:ازود|أزود|مرن|flex)/iu.test(text) ? "SOFT" : "LOW";
    next.currency = "EGP";
  }
  if (strict && /(?:لا\s+عاوز|لا\s+عايز|عاوزها|عايزها)/iu.test(text)) {
    const target = money(strict[1]);
    next.priceTarget = target;
    next.priceMax = target;
    next.budgetMax = target;
    next.budgetFlexibility = "NONE";
    next.currency = "EGP";
  }
  if (under) {
    next.priceMax = money(under[1]);
    next.budgetMax = next.priceMax;
    next.budgetFlexibility = "NONE";
    next.currency = "EGP";
  }
  if (rejected) {
    const rejectedPrice = money(rejected[1]);
    next.explicitRejectedPriceMin = rejectedPrice * 0.975;
    next.explicitRejectedPriceMax = rejectedPrice * 1.025;
    if (next.priceTarget && rejectedPrice > next.priceTarget)
      next.priceMax = next.budgetMax = Math.min(next.priceMax ?? rejectedPrice, Math.round(next.priceTarget * 1.05));
  }

  if (plan.intent === "INVENTORY_COUNT") { next.temporaryIntent = "INVENTORY_AGGREGATION"; next.aggregationDimension = "COUNT"; }
  if (plan.intent === "AREA_AGGREGATION") { next.temporaryIntent = "INVENTORY_AGGREGATION"; next.aggregationDimension = "BUILT_UP_AREA"; }
  if (plan.intent === "PRICE_AGGREGATION") { next.temporaryIntent = "INVENTORY_AGGREGATION"; next.aggregationDimension = "PRICE"; }
  if (plan.intent === "INVENTORY_AGGREGATION") {
    next.temporaryIntent = "INVENTORY_AGGREGATION";
    if (/(?:مطورين|المطورين|developers?)/iu.test(text)) next.aggregationDimension = "DEVELOPER";
    else if (/(?:مشاريع|المشاريع|projects?)/iu.test(text)) next.aggregationDimension = "PROJECT";
    else if (/(?:انواع\s+الوحدات|أنواع\s+الوحدات|unit types?)/iu.test(text)) next.aggregationDimension = "UNIT_TYPE";
    else if (/(?:غرف|bedrooms?)/iu.test(text)) next.aggregationDimension = "BEDROOM_COUNT";
    else if (/(?:تسليم|delivery)/iu.test(text)) next.aggregationDimension = "DELIVERY_DATE";
    else if (/(?:تقسيط|سداد|payment|installment)/iu.test(text)) next.aggregationDimension = "PAYMENT_DURATION";
  }

  return next;
}

export function nextPresentation(previous: PresentationState | undefined, patch: Partial<PresentationState>): PresentationState {
  return { presentedUnitIds: [], ...previous, ...patch };
}

export function unpresentedUnitIds(candidateIds: string[], presentedIds: string[] = []) {
  const presented = new Set(presentedIds);
  return candidateIds.filter((id) => !presented.has(id));
}
