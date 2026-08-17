import { AnswerInput, CustomerTurnIntent } from "./ai-provider";

export type GroqModelRole =
  | "ARABIC_FAST"
  | "GENERAL"
  | "REASONING";

export type GroqRoute = {
  role: GroqModelRole;
  model: string;
  fallbacks: string[];
  reason: string;
};

/**
 * Groq text-model pool.
 *
 * IMPORTANT:
 * - Do NOT use Whisper here: speech-to-text only.
 * - Do NOT use Orpheus here: text-to-speech models.
 * - Do NOT use Prompt Guard as a customer response model.
 *
 * Current strategy:
 *
 * Simple / short Arabic
 *   → llama-3.1-8b-instant
 *
 * Normal real-estate conversation
 *   → qwen/qwen3.6-27b
 *
 * Comparison / investment / resale / ambiguous / high intent
 *   → openai/gpt-oss-120b
 *
 * First strong fallback
 *   → llama-3.3-70b-versatile
 *
 * Last Groq fallback
 *   → openai/gpt-oss-20b
 */
const MODELS = {
  arabic:
    process.env.GROQ_ARABIC_MODEL ??
    "llama-3.1-8b-instant",

  general:
    process.env.GROQ_GENERAL_MODEL ??
    "qwen/qwen3.6-27b",

  reasoning:
    process.env.GROQ_REASONING_MODEL ??
    "openai/gpt-oss-120b",

  backup:
    process.env.GROQ_BACKUP_MODEL ??
    "llama-3.3-70b-versatile",

  lastResort:
    process.env.GROQ_LAST_RESORT_MODEL ??
    "openai/gpt-oss-20b",
} as const;

/**
 * Intents that should immediately use the strongest
 * reasoning/customer-advisor model.
 */
const REASONING_INTENTS = new Set<CustomerTurnIntent>([
  "COMPARISON",
  "INVESTMENT",
  "RESALE",
]);

/**
 * These intents normally do not need a 120B reasoning model
 * when the requested facts are already verified by the app/database.
 */
const SIMPLE_ARABIC_INTENTS = new Set<CustomerTurnIntent>([
  "SMALL_TALK",
  "FOLLOW_UP_CONFIRMATION",
  "CONTACT_REQUEST",

  "INVENTORY_COUNT",
  "INVENTORY_AGGREGATION",

  "PRICE_AGGREGATION",
  "AREA_AGGREGATION",
  "UNIT_TYPE_AGGREGATION",

  "LOCATION_REQUEST",
  "MEDIA_REQUEST",
  "BROCHURE_REQUEST",
  "AVAILABILITY_CHECK",
]);

function latestUserText(input: AnswerInput): string {
  return (
    [...input.messages]
      .reverse()
      .find((message) => message.role === "user")
      ?.content.trim() ?? ""
  );
}

function isArabic(text: string): boolean {
  return /[\u0600-\u06ff]/u.test(text);
}

function hasLatin(text: string): boolean {
  return /[a-z]/i.test(text);
}

function isMixed(text: string): boolean {
  return isArabic(text) && hasLatin(text);
}

/**
 * Egyptian/Arabic phrases which usually indicate that a cheap/fast
 * conversational response is enough.
 *
 * This is deliberately NOT a generic "Arabic = cheap model" rule.
 */
function isShortConversationalArabic(text: string): boolean {
  if (!isArabic(text)) return false;
  if (isMixed(text)) return false;

  const normalized = text.trim();

  if (!normalized) return false;
  if (normalized.length > 120) return false;

  return /^(?:اه|آه|أه|ايوه|أيوه|ايوة|أيوة|لا|لأ|تمام|ماشي|حلو|كويس|شكرا|شكرًا|تسلم|مساء|صباح|هاي|هلا|أهلا|اهلا|طيب|طب|اوكي|أوكي|موافق|ابعت|هات|وريني|كمل|اكمل|تمام كده|تمام كدا)\b/iu.test(
    normalized,
  );
}

/**
 * Detects questions where a bigger reasoning model is useful even if
 * the structured intent extractor did not classify the turn perfectly.
 */
function looksAmbiguousOrReasoningHeavy(text: string): boolean {
  return /(?:أنهي|انهي|إيه الأفضل|ايه الأفضل|اي الأفضل|الأفضل|افضل|أفضل|ليه|لماذا|قارن|مقارنة|فرق السعر|الفرق يستاهل|يستاهل|استثمار|استثماري|عائد|ROI|إعادة بيع|اعادة بيع|ريسيل|resale|investment|compare|comparison|better|worth|trade.?off|pros?|cons?|مميزات|عيوب|اختار|أختار|اختيار|محتار|تنصحني|ترشحلي|ارشحلي|أرشحلي)/iu.test(
    text,
  );
}

/**
 * Detect cases where the customer is asking for reasoning involving
 * financing/payment tradeoffs rather than simply requesting plan data.
 */
function looksPaymentReasoningHeavy(text: string): boolean {
  return /(?:أقل مقدم|اقل مقدم|أقل قسط|اقل قسط|أطول فترة|اطول فترة|أنهي خطة|انهي خطة|أفضل خطة|افضل خطة|الكاش ولا|قسط ولا|تقسيط ولا|فرق التقسيط|فرق الكاش|فرق الإجمالي|فرق الاجمالي|يزود الإجمالي|يزود الاجمالي|payment plan|down payment|installment|cash vs|finance)/iu.test(
    text,
  );
}

/**
 * Detects investment/sales reasoning that may not have been perfectly
 * represented in turnIntent yet.
 */
function looksInvestmentHeavy(text: string): boolean {
  return /(?:استثمار|استثماري|عائد|إيجار|ايجار|إعادة البيع|اعادة البيع|إعادة بيع|اعادة بيع|ريسيل|resale|ROI|capital appreciation|rent yield|rental yield|إعادة بيعه|اعادة بيعه)/iu.test(
    text,
  );
}

/**
 * High-intent user text fallback.
 *
 * purchaseIntent from structured extraction remains the preferred source,
 * but this catches obvious cases if extraction is degraded.
 */
function looksHighPurchaseIntent(text: string): boolean {
  return /(?:عاوز أحجز|عاوز احجز|احجز|أحجز|حجز الوحدة|إجراءات الحجز|اجراءات الحجز|عاوز أعاين|عاوز اعاين|معاينة|حد يكلمني|حد يتواصل|كلمني|اتصل بيا|مهتم بالوحدة|عايز الوحدة|عاوز الوحدة|عايز أشتري|عاوز أشتري|جاهز أشتري|ready to buy|book it|reserve|reservation|viewing|contact me|call me)/iu.test(
    text,
  );
}

function uniqueModels(models: string[]): string[] {
  return [...new Set(models.filter(Boolean))];
}

function reasoningFallbacks(): string[] {
  return uniqueModels([
    MODELS.general,
    MODELS.backup,
    MODELS.lastResort,
    MODELS.arabic,
  ]);
}

function generalFallbacks(): string[] {
  return uniqueModels([
    MODELS.backup,
    MODELS.reasoning,
    MODELS.lastResort,
    MODELS.arabic,
  ]);
}

function fastFallbacks(): string[] {
  return uniqueModels([
    MODELS.general,
    MODELS.backup,
    MODELS.lastResort,
    MODELS.reasoning,
  ]);
}

export function routeCustomerModel(input: AnswerInput): GroqRoute {
  const text = latestUserText(input);

  const turnIntent = input.intent.turnIntent;

  const purchaseIntent =
    typeof input.intent.purchaseIntent === "number"
      ? input.intent.purchaseIntent
      : 0;

  const highIntent =
    purchaseIntent >= 80 ||
    looksHighPurchaseIntent(text);

  const complexContext =
    REASONING_INTENTS.has(turnIntent ?? "UNKNOWN") ||
    [
      "INVESTMENT",
      "RESALE",
      "RENTAL",
      "COMPARISON",
    ].includes(input.contextKind ?? "");

  const mixedLanguage = isMixed(text);

  const semanticReasoning =
    looksAmbiguousOrReasoningHeavy(text) ||
    looksInvestmentHeavy(text) ||
    looksPaymentReasoningHeavy(text);

  /**
   * Strong reasoning route.
   *
   * Examples:
   * - "أنهي واحدة أحسن للاستثمار؟"
   * - "لو زودت مليون يستاهل؟"
   * - "إعادة البيع في أنهي مشروع أحسن؟"
   * - mixed Arabic/English complex questions
   * - strong buying intent
   */
  if (
    complexContext ||
    highIntent ||
    mixedLanguage ||
    semanticReasoning
  ) {
    let reason = "complex-real-estate-reasoning";

    if (highIntent) {
      reason = "high-purchase-intent";
    } else if (complexContext) {
      reason = "complex-real-estate-context";
    } else if (mixedLanguage) {
      reason = "mixed-language";
    } else if (looksInvestmentHeavy(text)) {
      reason = "investment-or-resale-reasoning";
    } else if (looksPaymentReasoningHeavy(text)) {
      reason = "payment-plan-reasoning";
    } else {
      reason = "semantic-ambiguity";
    }

    return {
      role: "REASONING",
      model: MODELS.reasoning,
      fallbacks: reasoningFallbacks(),
      reason,
    };
  }

  /**
   * Fast/simple Arabic route.
   *
   * This should be used only when:
   * - language is Arabic
   * - the task is simple
   * - there isn't lots of verified inventory context to explain
   *
   * It is NOT used for investment/comparison simply because
   * the customer wrote Arabic.
   */
  const simpleArabic =
    input.intent.language?.startsWith("ar") &&
    (
      SIMPLE_ARABIC_INTENTS.has(turnIntent ?? "UNKNOWN") ||
      isShortConversationalArabic(text)
    ) &&
    (input.verifiedFacts?.length ?? 0) <= 1;

  if (simpleArabic) {
    return {
      role: "ARABIC_FAST",
      model: MODELS.arabic,
      fallbacks: fastFallbacks(),
      reason: isShortConversationalArabic(text)
        ? "short-arabic-conversation"
        : "simple-arabic-task",
    };
  }

  /**
   * Default customer conversation.
   *
   * Examples:
   * - ordinary property search
   * - explaining verified search results
   * - asking one natural follow-up question
   * - normal multi-turn real-estate conversation
   */
  return {
    role: "GENERAL",
    model: MODELS.general,
    fallbacks: generalFallbacks(),
    reason: "default-customer-conversation",
  };
}

export function configuredGroqModels() {
  return {
    /**
     * Kept as `arabic` for backward compatibility with
     * existing code/configuration.
     *
     * It now means the fast/simple Arabic conversation model,
     * not an Arabic-specialized model.
     */
    arabic: MODELS.arabic,

    general: MODELS.general,
    reasoning: MODELS.reasoning,
    backup: MODELS.backup,
    lastResort: MODELS.lastResort,
  };
}