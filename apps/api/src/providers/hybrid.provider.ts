import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  AIHealth,
  AIMessage,
  AIProvider,
  AITraceContext,
  AnswerInput,
  StructuredIntent,
} from "./ai-provider";
import { CloudflareWorkersAIProvider } from "./cloudflare-workers-ai.provider";
import { GroqProvider } from "./groq.provider";
import { OpenAIProvider } from "./openai.provider";
import { AIUpstreamError, unavailable } from "./provider-utils";
import {
  detectExplicitSalesSignals,
  detectExplicitRouteRequest,
  detectRequestedMedia,
  deterministicIntent,
} from "./deterministic-intent";
import { AIUsageService } from "./ai-usage.service";
import { normalizeRealEstateSemantics } from "./real-estate-semantics";

@Injectable()
export class HybridAIProvider implements AIProvider {
  private readonly logger = new Logger(HybridAIProvider.name);
  constructor(
    readonly workers: CloudflareWorkersAIProvider,
    readonly groq: GroqProvider,
    readonly openai: OpenAIProvider,
    @Optional() private readonly usage?: AIUsageService,
  ) {}

  validateConfiguration() {
    this.workers.validateConfiguration();
    this.groq.validateConfiguration();
  }
  async extractIntent(messages: AIMessage[], previous: StructuredIntent, context: AITraceContext = {}) {
    const started = Date.now();
    try {
      const result = await this.workers.extractIntent(messages, previous);
      const requestedMedia = detectRequestedMedia(
        messages.at(-1)?.content ?? "",
      );
      const sales = detectExplicitSalesSignals(messages.at(-1)?.content ?? "");
      const route = detectExplicitRouteRequest(messages.at(-1)?.content ?? "");
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "intent",
        latencyMs: Date.now() - started,
        success: true,
      });
      this.logger.log(`AIProviderTrace ${JSON.stringify({ requestId: context.requestId ?? "unknown", conversationId: context.conversationId ?? "unknown", provider: "workers", model: this.workers.fastModel, stage: "WORKERS_EXTRACTION", upstreamStatus: 200, errorCategory: null, fallbackAttempted: false, fallbackSucceeded: null })}`);
      return normalizeRealEstateSemantics(messages.at(-1)?.content ?? "", {
        ...result,
        requestedMedia,
        ...(sales.contactName ? { contactName: sales.contactName } : {}),
        ...(sales.contactPhone ? { contactPhone: sales.contactPhone } : {}),
        ...(sales.purchaseIntent
          ? { purchaseIntent: Math.max(result.purchaseIntent ?? 0, sales.purchaseIntent) }
          : {}),
        ...(route ?? {}),
      }, previous);
    } catch (error) {
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "intent",
        latencyMs: Date.now() - started,
        success: false,
        errorCode: error instanceof AIUpstreamError ? error.code : "UNKNOWN",
      });
      const upstream = error instanceof AIUpstreamError ? error : undefined;
      this.logger.warn(`AIProviderTrace ${JSON.stringify({ requestId: context.requestId ?? "unknown", conversationId: context.conversationId ?? "unknown", provider: "workers", model: this.workers.fastModel, stage: "WORKERS_EXTRACTION", upstreamStatus: upstream?.status ?? null, errorCategory: upstream?.code ?? "UNKNOWN", fallbackAttempted: true, fallbackSucceeded: true })}`);
      this.logger.warn(
        "Workers intent extraction unavailable; using deterministic extraction",
      );
      return normalizeRealEstateSemantics(messages.at(-1)?.content ?? "", deterministicIntent(messages, previous), previous);
    }
  }
  async extractKnowledge(sourceText: string) {
    const started = Date.now();
    try {
      const result = await this.workers.extractKnowledge(sourceText);
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "knowledge",
        latencyMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch {
      this.logger.warn(
        "Workers knowledge extraction unavailable; preserving source for manual review",
      );
      return { extractionUnavailable: true, sourceLength: sourceText.length };
    }
  }
  async mapColumns(
    headers: string[],
    sampleRows: unknown[][],
    canonicalFields: string[],
  ) {
    const started = Date.now();
    try {
      const result = await this.workers.mapColumns(
        headers,
        sampleRows,
        canonicalFields,
      );
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "column_mapping",
        latencyMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch {
      this.logger.warn(
        "Workers column mapping unavailable; continuing with manual mapping",
      );
      return [];
    }
  }

  private shouldFallback(error: unknown) {
    return error instanceof AIUpstreamError
      ? error.retryable || !error.status
      : true;
  }
  private traceFailure(input: AnswerInput, provider: string, model: string, stage: string, error: unknown, fallbackAttempted: boolean, fallbackSucceeded?: boolean) {
    const upstream = error instanceof AIUpstreamError ? error : undefined;
    this.logger.warn(`AIProviderTrace ${JSON.stringify({ requestId: input.requestId ?? "unknown", conversationId: input.conversationId ?? "unknown", provider, model, stage, upstreamStatus: upstream?.status ?? null, errorCategory: upstream?.code ?? "UNKNOWN", fallbackAttempted, fallbackSucceeded: fallbackSucceeded ?? null })}`);
  }
  private temporaryAnswer(input: AnswerInput) {
    return input.intent.language?.startsWith("ar")
      ? "خدمة المستشار غير متاحة للحظات. بيانات الوحدات لم تتغير، جرّب رسالتك مرة أخرى بعد قليل."
      : "The property advisor is temporarily unavailable. No inventory facts were generated; please try again shortly.";
  }
  async composeAnswer(input: AnswerInput) {
    let started = Date.now();
    try {
      const result = await this.groq.composeAnswer(input);
      await this.usage?.record({
        provider: "groq",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        taskType: "customer_answer",
        latencyMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch (groqError) {
      this.traceFailure(input, "groq", process.env.GROQ_MODEL || "openai/gpt-oss-120b", "GROQ_GENERATION", groqError, true);
      await this.usage?.record({
        provider: "groq",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        taskType: "customer_answer",
        latencyMs: Date.now() - started,
        success: false,
        errorCode:
          groqError instanceof AIUpstreamError ? groqError.code : "UNKNOWN",
      });
      if (!this.shouldFallback(groqError)) unavailable("groq", groqError);
      this.logger.warn("Groq generation unavailable; using OpenAI fallback");
      started = Date.now();
      try {
        const result = await this.openai.composeAnswer(input);
        this.logger.log(`AIProviderTrace ${JSON.stringify({ requestId: input.requestId ?? "unknown", conversationId: input.conversationId ?? "unknown", provider: "openai", stage: "OPENAI_FALLBACK", fallbackSucceeded: true })}`);
        await this.usage?.record({
          provider: "openai",
          model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
          taskType: "customer_answer",
          latencyMs: Date.now() - started,
          success: true,
          fallbackUsed: true,
        });
        return result;
      } catch (openaiError) {
        this.traceFailure(input, "openai", process.env.OPENAI_TEXT_MODEL || "gpt-5-mini", "OPENAI_FALLBACK", openaiError, true, false);
        this.logger.warn(
          "OpenAI generation unavailable; using Workers AI compatibility fallback",
        );
        try {
          return await this.workers.composeAnswer(input);
        } catch (workersError) {
          this.traceFailure(input, "workers", this.workers.primaryModel, "WORKERS_RESPONSE_FALLBACK", workersError, false, false);
          return this.temporaryAnswer(input);
        }
      }
    }
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    let started = Date.now();
    let emitted = false;
    try {
      for await (const chunk of this.groq.streamAnswer(input)) { emitted = true; yield chunk; }
      await this.usage?.record({
        provider: "groq",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        taskType: "customer_stream",
        latencyMs: Date.now() - started,
        success: true,
      });
      return;
    } catch (groqError) {
      this.traceFailure(input, "groq", process.env.GROQ_MODEL || "openai/gpt-oss-120b", "GROQ_GENERATION", groqError, !emitted);
      await this.usage?.record({
        provider: "groq",
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        taskType: "customer_stream",
        latencyMs: Date.now() - started,
        success: false,
        errorCode:
          groqError instanceof AIUpstreamError ? groqError.code : "UNKNOWN",
      });
      if (emitted || !this.shouldFallback(groqError)) unavailable("groq", groqError);
      this.logger.warn("Groq stream unavailable; using OpenAI stream fallback");
    }
    started = Date.now();
    try {
      for await (const chunk of this.openai.streamAnswer(input)) yield chunk;
      this.logger.log(`AIProviderTrace ${JSON.stringify({ requestId: input.requestId ?? "unknown", conversationId: input.conversationId ?? "unknown", provider: "openai", stage: "OPENAI_FALLBACK", fallbackSucceeded: true })}`);
      await this.usage?.record({
        provider: "openai",
        model: process.env.OPENAI_TEXT_MODEL || "gpt-5-mini",
        taskType: "customer_stream",
        latencyMs: Date.now() - started,
        success: true,
        fallbackUsed: true,
      });
      return;
    } catch (openaiError) {
      this.traceFailure(input, "openai", process.env.OPENAI_TEXT_MODEL || "gpt-5-mini", "OPENAI_FALLBACK", openaiError, true, false);
      this.logger.warn(
        "OpenAI stream unavailable; using Workers AI compatibility fallback",
      );
      try {
        yield await this.workers.composeAnswer(input);
      } catch (workersError) {
        this.traceFailure(input, "workers", this.workers.primaryModel, "WORKERS_RESPONSE_FALLBACK", workersError, false, false);
        yield this.temporaryAnswer(input);
      }
    }
  }

  async health(): Promise<AIHealth[]> {
    return Promise.all([
      this.workers.health(),
      this.groq.health(),
      this.openai.health(),
    ]);
  }
}
