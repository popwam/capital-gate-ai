import { AnswerInput, CustomerTurnIntent } from "./ai-provider";

/**
 * Simplified two-tier routing: FAST for simple queries, STANDARD for everything else.
 *
 * Previously had three tiers (FAST/GENERAL/REASONING) but GENERAL and REASONING both
 * defaulted to the same model (openai/gpt-oss-120b), creating an illusion of
 * specialized routing without actual differentiation.
 *
 * Current policy:
 * - FAST (openai/gpt-oss-20b): Small talk, confirmations, simple queries <90 chars
 * - STANDARD (openai/gpt-oss-120b): All real estate conversations, comparisons, detailed queries
 */
export type GroqModelRole = "FAST" | "STANDARD";

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
  // GROQ_GENERAL_MODEL and GROQ_REASONING_MODEL both map to 'standard' for backward compatibility
  standard: envModel("GROQ_STANDARD_MODEL", envModel("GROQ_GENERAL_MODEL", envModel("GROQ_REASONING_MODEL", "openai/gpt-oss-120b"))),
  backup: envModel("GROQ_BACKUP_MODEL", "openai/gpt-oss-20b"),
  lastResort: envModel("GROQ_LAST_RESORT_MODEL", "openai/gpt-oss-20b"),
} as const;

/**
 * Intents that trigger FAST model (small, cheap, quick):
 * - Simple confirmations and greetings
 * - Media/document requests (deterministic responses)
 * - Basic availability checks
 */
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

function isShortConversational(text: string) {
  const normalized = text.trim();
  if (!normalized || normalized.length > 90) return false;
  return /^(?:اه|آه|أه|ايوه|أيوه|ايوة|أيوة|لا|لأ|تمام|ماشي|حلو|كويس|شكرا|شكرًا|تسلم|مساء|صباح|هاي|هلا|أهلا|اهلا|طيب|طب|اوكي|أوكي|موافق|ابعت|هات|وريني|كمل|اكمل|تمام كده|تمام كدا|yes|no|ok|okay|thanks?|thank you)\b/iu.test(normalized);
}

function unique(models: string[]) { return [...new Set(models.filter(Boolean))]; }

function standardFallbacks() { return unique([MODELS.backup, MODELS.lastResort]); }
function fastFallbacks() { return unique([MODELS.standard, MODELS.backup, MODELS.lastResort]); }

/**
 * Route to appropriate model based on conversation complexity.
 *
 * FAST: Short conversational turns, simple queries, minimal database context
 * STANDARD: All real estate conversations (search, comparison, investment, payment plans)
 *
 * Simplified from previous three-tier system where GENERAL and REASONING were
 * functionally identical.
 */
export function routeCustomerModel(input: AnswerInput): GroqRoute {
  const text = latestUserText(input);
  const turnIntent = input.intent.turnIntent;

  // Use FAST model for simple conversational turns with minimal context
  if (
    (FAST_INTENTS.has(turnIntent ?? "UNKNOWN") || isShortConversational(text)) &&
    (input.verifiedFacts?.length ?? 0) <= 1
  ) {
    return {
      role: "FAST",
      model: MODELS.fast,
      fallbacks: fastFallbacks(),
      reason: isShortConversational(text) ? "short-conversational" : "simple-intent",
    };
  }

  // Use STANDARD model for all real estate conversations
  // (search, comparison, investment, payment plans, detailed queries)
  return {
    role: "STANDARD",
    model: MODELS.standard,
    fallbacks: standardFallbacks(),
    reason: "real-estate-conversation",
  };
}

export function configuredGroqModels() {
  return {
    // `arabic` is retained for compatibility with existing health/admin code.
    arabic: MODELS.fast,
    fast: MODELS.fast,
    standard: MODELS.standard,
    // Legacy aliases for backward compatibility
    general: MODELS.standard,
    reasoning: MODELS.standard,
    backup: MODELS.backup,
    lastResort: MODELS.lastResort,
  };
}
