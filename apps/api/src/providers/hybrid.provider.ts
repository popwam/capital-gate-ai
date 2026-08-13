import { Injectable, Logger, Optional } from "@nestjs/common";
import {
  AIHealth,
  AIMessage,
  AIProvider,
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
  async extractIntent(messages: AIMessage[], previous: StructuredIntent) {
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
      return {
        ...result,
        requestedMedia,
        ...(sales.contactName ? { contactName: sales.contactName } : {}),
        ...(sales.contactPhone ? { contactPhone: sales.contactPhone } : {}),
        ...(sales.purchaseIntent
          ? { purchaseIntent: Math.max(result.purchaseIntent ?? 0, sales.purchaseIntent) }
          : {}),
        ...(route ?? {}),
      };
    } catch (error) {
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "intent",
        latencyMs: Date.now() - started,
        success: false,
        errorCode: error instanceof AIUpstreamError ? error.code : "UNKNOWN",
      });
      this.logger.warn(
        "Workers intent extraction unavailable; using deterministic extraction",
      );
      return deterministicIntent(messages, previous);
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
        this.logger.warn(
          "OpenAI generation unavailable; using Workers AI compatibility fallback",
        );
        try {
          return await this.workers.composeAnswer(input);
        } catch {
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
      this.logger.warn(
        "OpenAI stream unavailable; using Workers AI compatibility fallback",
      );
      try {
        yield await this.workers.composeAnswer(input);
      } catch {
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
