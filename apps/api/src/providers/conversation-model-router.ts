import { AnswerInput, CustomerTurnIntent } from "./ai-provider";

export type GroqModelRole = "FAST" | "GENERAL" | "REASONING";

export type GroqRoute = {
  role: GroqModelRole;
  model: string;
  fallbacks: string[];
  reason: string;
};

/**
 * Cg Ai production model policy.
 *
 * Customer answers only use production-grade text models by default. Preview or
 * retired model IDs can still be enabled deliberately with env flags, but an old
 * production .env cannot silently keep routing traffic to a removed model.
 *
 * Speech models (Whisper / Orpheus) and safety models (Prompt Guard / Safeguard)
 * are intentionally excluded from customer response generation.
 */
const RETIRED_OR_UNLISTED = new Set([
  "llama-3.1-8b-instant",
  "llama-3.3-70b-versatile",
]);

const PREVIEW_MODELS = new Set([
  "qwen/qwen3.6-27b",
  "canopylabs/orpheus-v1-english",
  "canopylabs/orpheus-arabic-saudi",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "openai/gpt-oss-safeguard-20b",
]);

function envModel(name: string, fallback: string) {
  const requested = process.env[name]?.trim();
  if (!requested) return fallback;
  if (RETIRED_OR_UNLISTED.has(requested) && process.env.ALLOW_UNLISTED_GROQ_MODELS !== "true") return fallback;
  if (PREVIEW_MODELS.has(requested) && process.env.ALLOW_PREVIEW_GROQ_MODELS !== "true") return fallback;
  return requested;
}

const MODELS = {
  fast: envModel("GROQ_FAST_MODEL", envModel("GROQ_ARABIC_MODEL", "openai/gpt-oss-20b")),
  general: envModel("GROQ_GENERAL_MODEL", "openai/gpt-oss-120b"),
  reasoning: envModel("GROQ_REASONING_MODEL", "openai/gpt-oss-120b"),
  backup: envModel("GROQ_BACKUP_MODEL", "openai/gpt-oss-20b"),
  lastResort: envModel("GROQ_LAST_RESORT_MODEL", "openai/gpt-oss-20b"),
} as const;

const REASONING_INTENTS = new Set<CustomerTurnIntent>([
  "COMPARISON",
  "INVESTMENT",
  "RESALE",
  "PAYMENT_PLAN",
  "PROJECT_DETAILS",
  "DEVELOPER_DETAILS",
]);

const FAST_INTENTS = new Set<CustomerTurnIntent>([
  "SMALL_TALK",
  "FOLLOW_UP_CONFIRMATION",
  "CONTACT_REQUEST",
  "MEDIA_REQUEST",
  "BROCHURE_REQUEST",
  "LOCATION_REQUEST",
  "AVAILABILITY_CHECK",
]);

function latestUserText(input: AnswerInput): string {
  return [...input.messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
}

function hasArabic(text: string) { return /[\u0600-\u06ff]/u.test(text); }
function hasLatin(text: string) { return /[a-z]/i.test(text); }
function isMixed(text: string) { return hasArabic(text) && hasLatin(text); }

function isShortConversational(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 90) return false;
  return /^(?:اه|آه|أه|ايوه|أيوه|ايوة|أيوة|لا|لأ|تمام|ماشي|حلو|كويس|شكرا|شكرًا|تسلم|مساء|صباح|هاي|هلا|أهلا|اهلا|طيب|طب|اوكي|أوكي|موافق|ابعت|هات|وريني|كمل|اكمل|تمام كده|تمام كدا|yes|no|ok|okay|thanks?|thank you)\b/iu.test(normalized);
}

function needsReasoning(text: string) {
  return /(?:أنهي|انهي|إيه الأفضل|ايه الأفضل|الأفضل|افضل|أفضل|ليه|لماذا|قارن|مقارنة|فرق السعر|يستاهل|استثمار|استثماري|عائد|ROI|إعادة بيع|اعادة بيع|ريسيل|resale|investment|compare|comparison|better|worth|trade.?off|مميزات|عيوب|اختار|أختار|محتار|تنصحني|ترشحلي|أقل مقدم|اقل مقدم|أقل قسط|اقل قسط|أطول فترة|اطول فترة|أنهي خطة|انهي خطة|أفضل خطة|افضل خطة|الكاش ولا|قسط ولا|payment plan|down payment|installment|cash vs)/iu.test(text);
}

function highPurchaseIntent(text: string) {
  return /(?:عاوز أحجز|عاوز احجز|احجز|أحجز|حجز الوحدة|إجراءات الحجز|اجراءات الحجز|عاوز أعاين|عاوز اعاين|معاينة|حد يكلمني|حد يتواصل|كلمني|اتصل بيا|مهتم بالوحدة|عايز الوحدة|عاوز الوحدة|عايز أشتري|عاوز أشتري|جاهز أشتري|ready to buy|book it|reserve|reservation|viewing|contact me|call me)/iu.test(text);
}

function unique(models: string[]) { return [...new Set(models.filter(Boolean))]; }

function reasoningFallbacks() { return unique([MODELS.backup, MODELS.general, MODELS.lastResort, MODELS.fast]); }
function generalFallbacks() { return unique([MODELS.backup, MODELS.reasoning, MODELS.lastResort, MODELS.fast]); }
function fastFallbacks() { return unique([MODELS.general, MODELS.backup, MODELS.reasoning, MODELS.lastResort]); }

export function routeCustomerModel(input: AnswerInput): GroqRoute {
  const text = latestUserText(input);
  const turnIntent = input.intent.turnIntent;
  const purchaseIntent = typeof input.intent.purchaseIntent === "number" ? input.intent.purchaseIntent : 0;
  const complexContext = REASONING_INTENTS.has(turnIntent ?? "UNKNOWN") || ["INVESTMENT", "RESALE", "RENTAL", "COMPARISON", "PROJECT_DETAILS"].includes(input.contextKind ?? "");

  if (complexContext || purchaseIntent >= 80 || highPurchaseIntent(text) || isMixed(text) || needsReasoning(text)) {
    return {
      role: "REASONING",
      model: MODELS.reasoning,
      fallbacks: reasoningFallbacks(),
      reason: purchaseIntent >= 80 || highPurchaseIntent(text)
        ? "high-purchase-intent"
        : complexContext
          ? "complex-real-estate-context"
          : isMixed(text)
            ? "mixed-language"
            : "semantic-reasoning",
    };
  }

  if ((FAST_INTENTS.has(turnIntent ?? "UNKNOWN") || isShortConversational(text)) && (input.verifiedFacts?.length ?? 0) <= 1) {
    return {
      role: "FAST",
      model: MODELS.fast,
      fallbacks: fastFallbacks(),
      reason: isShortConversational(text) ? "short-conversation" : "simple-deterministic-context",
    };
  }

  return {
    role: "GENERAL",
    model: MODELS.general,
    fallbacks: generalFallbacks(),
    reason: "default-customer-conversation",
  };
}

export function configuredGroqModels() {
  return {
    // `arabic` is retained for compatibility with existing health/admin code.
    arabic: MODELS.fast,
    fast: MODELS.fast,
    general: MODELS.general,
    reasoning: MODELS.reasoning,
    backup: MODELS.backup,
    lastResort: MODELS.lastResort,
  };
}
