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
  detectExplicitRouteRequest,
  detectExplicitSalesSignals,
  detectRequestedMedia,
  deterministicIntent,
} from "./deterministic-intent";
import { AIUsageService } from "./ai-usage.service";
import { normalizeRealEstateSemantics } from "./real-estate-semantics";
import { compactAnswerInput } from "./ai-context";
import {
  configuredGroqModels,
  GroqRoute,
  routeCustomerModel,
} from "./conversation-model-router";

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

  async extractIntent(
    messages: AIMessage[],
    previous: StructuredIntent,
    context: AITraceContext = {},
  ) {
    const started = Date.now();
    try {
      const result = await this.workers.extractIntent(messages, previous);
      const latest = messages.at(-1)?.content ?? "";
      const requestedMedia = detectRequestedMedia(latest);
      const sales = detectExplicitSalesSignals(latest);
      const route = detectExplicitRouteRequest(latest);

      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "intent",
        latencyMs: Date.now() - started,
        success: true,
      });

      this.logger.log(`AIProviderTrace ${JSON.stringify({
        requestId: context.requestId ?? "unknown",
        conversationId: context.conversationId ?? "unknown",
        provider: "workers",
        model: this.workers.fastModel,
        stage: "WORKERS_EXTRACTION",
        upstreamStatus: 200,
        errorCategory: null,
        fallbackAttempted: false,
        fallbackSucceeded: null,
      })}`);

      return normalizeRealEstateSemantics(latest, {
        ...result,
        requestedMedia,
        ...(sales.contactName ? { contactName: sales.contactName } : {}),
        ...(sales.contactPhone ? { contactPhone: sales.contactPhone } : {}),
        ...(sales.purchaseIntent ? { purchaseIntent: Math.max(result.purchaseIntent ?? 0, sales.purchaseIntent) } : {}),
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
      this.logger.warn(`AIProviderTrace ${JSON.stringify({
        requestId: context.requestId ?? "unknown",
        conversationId: context.conversationId ?? "unknown",
        provider: "workers",
        model: this.workers.fastModel,
        stage: "WORKERS_EXTRACTION",
        upstreamStatus: upstream?.status ?? null,
        errorCategory: upstream?.code ?? "UNKNOWN",
        fallbackAttempted: true,
        fallbackSucceeded: true,
      })}`);
      this.logger.warn("Workers intent extraction unavailable; using deterministic extraction");

      return normalizeRealEstateSemantics(
        messages.at(-1)?.content ?? "",
        deterministicIntent(messages, previous),
        previous,
      );
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
      this.logger.warn("Workers knowledge extraction unavailable; preserving source for manual review");
      return { extractionUnavailable: true, sourceLength: sourceText.length };
    }
  }

  async mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]) {
    const started = Date.now();
    try {
      const result = await this.workers.mapColumns(headers, sampleRows, canonicalFields);
      await this.usage?.record({
        provider: "workers",
        model: this.workers.fastModel,
        taskType: "column_mapping",
        latencyMs: Date.now() - started,
        success: true,
      });
      return result;
    } catch {
      this.logger.warn("Workers column mapping unavailable; continuing with manual mapping");
      return [];
    }
  }

  private shouldFallback(error: unknown) {
    return error instanceof AIUpstreamError
      ? error.status === 413 || error.status === 429 || error.retryable || !error.status
      : true;
  }

  private is413(error: unknown) {
    return error instanceof AIUpstreamError && (error.status === 413 || error.code === "HTTP_413");
  }

  private traceFailure(
    input: AnswerInput,
    provider: string,
    model: string,
    stage: string,
    error: unknown,
    fallbackAttempted: boolean,
    fallbackSucceeded?: boolean,
  ) {
    const upstream = error instanceof AIUpstreamError ? error : undefined;
    this.logger.warn(`AIProviderTrace ${JSON.stringify({
      requestId: input.requestId ?? "unknown",
      conversationId: input.conversationId ?? "unknown",
      provider,
      model,
      stage,
      upstreamStatus: upstream?.status ?? null,
      errorCategory: upstream?.code ?? "UNKNOWN",
      fallbackAttempted,
      fallbackSucceeded: fallbackSucceeded ?? null,
    })}`);
  }

  private modelRouteTrace(input: AnswerInput, route: GroqRoute) {
    this.logger.log(`AIModelRoute ${JSON.stringify({
      requestId: input.requestId ?? "unknown",
      conversationId: input.conversationId ?? "unknown",
      role: route.role,
      model: route.model,
      reason: route.reason,
      fallbackModels: route.fallbacks,
    })}`);
  }

  private uniqueModels(route: GroqRoute) {
    return [...new Set([route.model, ...route.fallbacks])];
  }

  private async recordGroq(
    model: string,
    taskType: string,
    started: number,
    success: boolean,
    fallbackUsed: boolean,
    error?: unknown,
  ) {
    await this.usage?.record({
      provider: "groq",
      model,
      taskType,
      latencyMs: Date.now() - started,
      success,
      fallbackUsed,
      ...(success ? {} : { errorCode: error instanceof AIUpstreamError ? error.code : "UNKNOWN" }),
    });
  }

  private async composeWithGroqRoute(input: AnswerInput, route: GroqRoute): Promise<string> {
    const models = this.uniqueModels(route);
    let lastError: unknown;
    let candidateInput = input;

    for (let index = 0; index < models.length; index++) {
      const model = models[index];
      const started = Date.now();
      try {
        const answer = await this.groq.composeAnswerWithModel(candidateInput, model);
        await this.recordGroq(model, "customer_answer", started, true, index > 0);
        this.logger.log(`AIProviderTrace ${JSON.stringify({
          requestId: input.requestId ?? "unknown",
          conversationId: input.conversationId ?? "unknown",
          provider: "groq",
          model,
          stage: index === 0 ? "GROQ_GENERATION" : "GROQ_MODEL_FALLBACK",
          upstreamStatus: 200,
          fallbackAttempted: index > 0,
          fallbackSucceeded: index > 0 ? true : null,
        })}`);
        return answer;
      } catch (error) {
        lastError = error;
        await this.recordGroq(model, "customer_answer", started, false, index > 0, error);
        this.traceFailure(candidateInput, "groq", model, index === 0 ? "GROQ_GENERATION" : "GROQ_MODEL_FALLBACK", error, index < models.length - 1, false);
        if (this.is413(error)) candidateInput = compactAnswerInput(input, "aggressive");
        if (!this.shouldFallback(error)) break;
      }
    }

    throw lastError ?? new AIUpstreamError("groq", "ALL_MODELS_FAILED");
  }

  async composeAnswer(input: AnswerInput) {
    const route = routeCustomerModel(input);
    this.modelRouteTrace(input, route);
    let fallbackInput = input;

    try {
      return await this.composeWithGroqRoute(input, route);
    } catch (groqError) {
      fallbackInput = this.is413(groqError) ? compactAnswerInput(input, "aggressive") : compactAnswerInput(input, "normal");
      this.logger.warn("All selected Groq models unavailable; using OpenAI fallback");
      const started = Date.now();

      try {
        const result = await this.openai.composeAnswer(fallbackInput);
        this.logger.log(`AIProviderTrace ${JSON.stringify({
          requestId: input.requestId ?? "unknown",
          conversationId: input.conversationId ?? "unknown",
          provider: "openai",
          stage: "OPENAI_FALLBACK",
          fallbackSucceeded: true,
        })}`);
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
        this.traceFailure(fallbackInput, "openai", process.env.OPENAI_TEXT_MODEL || "gpt-5-mini", "OPENAI_FALLBACK", openaiError, true, false);
        this.logger.warn("OpenAI generation unavailable; using Workers AI compatibility fallback");
        try {
          return await this.workers.composeAnswer(fallbackInput);
        } catch (workersError) {
          this.traceFailure(fallbackInput, "workers", this.workers.primaryModel, "WORKERS_RESPONSE_FALLBACK", workersError, false, false);
          unavailable("workers", workersError);
        }
      }
    }
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    const route = routeCustomerModel(input);
    this.modelRouteTrace(input, route);
    const models = this.uniqueModels(route);
    let lastError: unknown;
    let candidateInput = input;

    for (let index = 0; index < models.length; index++) {
      const model = models[index];
      const started = Date.now();
      let emitted = false;

      try {
        for await (const chunk of this.groq.streamAnswerWithModel(candidateInput, model)) {
          if (!chunk) continue;
          emitted = true;
          yield chunk;
        }
        if (!emitted) throw new AIUpstreamError("groq", "EMPTY_STREAM_RESPONSE", 502, true);
        await this.recordGroq(model, "customer_stream", started, true, index > 0);
        return;
      } catch (error) {
        lastError = error;
        await this.recordGroq(model, "customer_stream", started, false, index > 0, error);
        this.traceFailure(candidateInput, "groq", model, index === 0 ? "GROQ_GENERATION" : "GROQ_MODEL_FALLBACK", error, !emitted && index < models.length - 1, false);

        if (emitted) unavailable("groq", error);
        if (this.is413(error)) candidateInput = compactAnswerInput(input, "aggressive");
        if (!this.shouldFallback(error)) break;
      }
    }

    if (lastError && !this.shouldFallback(lastError)) unavailable("groq", lastError);
    this.logger.warn("All selected Groq stream models unavailable; using OpenAI stream fallback");

    const openAIInput = lastError && this.is413(lastError)
      ? compactAnswerInput(input, "aggressive")
      : compactAnswerInput(input, "normal");
    const started = Date.now();

    try {
      let emitted = false;
      for await (const chunk of this.openai.streamAnswer(openAIInput)) { if (!chunk) continue; emitted = true; yield chunk; }
      if (!emitted) throw new AIUpstreamError("openai", "EMPTY_STREAM_RESPONSE", 502, true);
      this.logger.log(`AIProviderTrace ${JSON.stringify({
        requestId: input.requestId ?? "unknown",
        conversationId: input.conversationId ?? "unknown",
        provider: "openai",
        stage: "OPENAI_FALLBACK",
        fallbackSucceeded: true,
      })}`);
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
      this.traceFailure(openAIInput, "openai", process.env.OPENAI_TEXT_MODEL || "gpt-5-mini", "OPENAI_FALLBACK", openaiError, true, false);
      this.logger.warn("OpenAI stream unavailable; using Workers AI compatibility fallback");
      try {
        yield await this.workers.composeAnswer(openAIInput);
      } catch (workersError) {
        this.traceFailure(openAIInput, "workers", this.workers.primaryModel, "WORKERS_RESPONSE_FALLBACK", workersError, false, false);
        unavailable("workers", workersError);
      }
    }
  }

  async health(): Promise<AIHealth[]> {
    const base = await Promise.all([this.workers.health(), this.groq.health(), this.openai.health()]);
    const models = configuredGroqModels();
    return [
      ...base,
      {
        provider: "groq-router",
        configured: Boolean(process.env.GROQ_API_KEY),
        healthy: Boolean(process.env.GROQ_API_KEY),
        model: `${models.arabic} | ${models.general} | ${models.reasoning}`,
      },
    ];
  }
}
