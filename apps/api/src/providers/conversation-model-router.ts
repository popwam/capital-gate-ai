import { AnswerInput, CustomerTurnIntent } from "./ai-provider";

export type GroqModelRole = "ARABIC_FAST" | "GENERAL" | "REASONING";

export type GroqRoute = {
  role: GroqModelRole;
  model: string;
  fallbacks: string[];
  reason: string;
};

const MODELS = {
  arabic: process.env.GROQ_ARABIC_MODEL ?? "allam-2-7b",
  general: process.env.GROQ_GENERAL_MODEL ?? "qwen/qwen3.6-27b",
  reasoning: process.env.GROQ_REASONING_MODEL ?? "openai/gpt-oss-120b",
  backup: process.env.GROQ_BACKUP_MODEL ?? "openai/gpt-oss-20b",
} as const;

const REASONING_INTENTS = new Set<CustomerTurnIntent>([
  "COMPARISON",
  "INVESTMENT",
  "RESALE",
]);

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

function latestUserText(input: AnswerInput) {
  return [...input.messages]
    .reverse()
    .find((message) => message.role === "user")
    ?.content.trim() ?? "";
}

function isArabic(text: string) {
  return /[\u0600-\u06ff]/u.test(text);
}

function isMixed(text: string) {
  return isArabic(text) && /[a-z]/i.test(text);
}

function looksAmbiguousOrReasoningHeavy(text: string) {
  return /(?:أنهي|ايه الأفضل|إيه الأفضل|افضل|أفضل|ليه|لماذا|قارن|مقارنة|فرق السعر|يستاهل|استثمار|عائد|إعادة بيع|اعادة بيع|resale|investment|compare|better|worth|trade.?off|pros?|cons?|مميزات|عيوب|اختار)/iu.test(text);
}

function isShortConversationalArabic(text: string) {
  if (!isArabic(text) || isMixed(text)) return false;
  if (text.length > 100) return false;
  return /^(?:اه|أه|ايوه|أيوه|لا|تمام|ماشي|حلو|شكرا|شكرًا|مساء|صباح|هاي|هلا|طيب|طب|اوكي|أوكي|موافق|ابعت|هات|وريني)\b/iu.test(text);
}

export function routeCustomerModel(input: AnswerInput): GroqRoute {
  const text = latestUserText(input);
  const turnIntent = input.intent.turnIntent;
  const highIntent = (input.intent.purchaseIntent ?? 0) >= 80;
  const complexContext =
    REASONING_INTENTS.has(turnIntent ?? "UNKNOWN") ||
    ["INVESTMENT", "RESALE", "RENTAL", "COMPARISON"].includes(input.contextKind ?? "");

  if (complexContext || highIntent || isMixed(text) || looksAmbiguousOrReasoningHeavy(text)) {
    return {
      role: "REASONING",
      model: MODELS.reasoning,
      fallbacks: [MODELS.general, MODELS.backup, MODELS.arabic],
      reason: complexContext
        ? "complex-real-estate-reasoning"
        : highIntent
          ? "high-purchase-intent"
          : isMixed(text)
            ? "mixed-language"
            : "semantic-ambiguity",
    };
  }

  if (
    input.intent.language?.startsWith("ar") &&
    (SIMPLE_ARABIC_INTENTS.has(turnIntent ?? "UNKNOWN") || isShortConversationalArabic(text)) &&
    (input.verifiedFacts?.length ?? 0) <= 1
  ) {
    return {
      role: "ARABIC_FAST",
      model: MODELS.arabic,
      fallbacks: [MODELS.general, MODELS.backup, MODELS.reasoning],
      reason: "simple-arabic-conversation",
    };
  }

  return {
    role: "GENERAL",
    model: MODELS.general,
    fallbacks: [MODELS.backup, MODELS.reasoning, MODELS.arabic],
    reason: "default-customer-conversation",
  };
}

export function configuredGroqModels() {
  return {
    arabic: MODELS.arabic,
    general: MODELS.general,
    reasoning: MODELS.reasoning,
    backup: MODELS.backup,
  };
}
