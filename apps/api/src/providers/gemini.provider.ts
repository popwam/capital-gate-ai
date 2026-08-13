import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiError, GoogleGenAI } from "@google/genai";
import { randomUUID } from "node:crypto";
import {
  AIMessage,
  AIProvider,
  AnswerInput,
  StructuredIntent,
} from "./ai-provider";

export const GEMINI_API_VERSION = "v1beta";
export const GEMINI_GENERATION_METHOD = "generateContent";
const FLASH_ALIAS = "gemini-flash-latest";

export type GeminiErrorCategory =
  | "INVALID_ARGUMENT"
  | "AUTHENTICATION_OR_PERMISSION"
  | "MODEL_OR_ENDPOINT_NOT_FOUND"
  | "RESOURCE_EXHAUSTED"
  | "INTERNAL"
  | "UNAVAILABLE"
  | "UNKNOWN";

export type GeminiModelInfo = {
  name: string;
  supportedGenerationMethods: string[];
};

export type GeminiErrorDetails = {
  status: number;
  category: GeminiErrorCategory;
  message: string;
  creditsDepleted: boolean;
  retryable: boolean;
};

const intentSchema = {
  type: "object",
  properties: {
    language: { type: "string" },
    purpose: { type: "string", enum: ["LIVING", "INVESTMENT"] },
    locations: { type: "array", items: { type: "string" } },
    propertyTypes: { type: "array", items: { type: "string" } },
    bedrooms: { type: "integer" },
    bathrooms: { type: "integer" },
    budgetMin: { type: "number" },
    budgetMax: { type: "number" },
    currency: { type: "string" },
    deliveryMaxYears: { type: "number" },
    maxDownPayment: { type: "number" },
    maxTravelMinutes: { type: "integer" },
    hardRequirements: { type: "array", items: { type: "string" } },
    softPreferences: { type: "array", items: { type: "string" } },
    requestedMedia: {
      type: "string",
      enum: ["IMAGES", "BROCHURE", "MAP"],
    },
    requestedProject: { type: "string" },
    exactRouteRequested: { type: "boolean" },
    routeOrigin: { type: "string" },
    routeDestination: { type: "string" },
    purchaseIntent: { type: "integer", minimum: 0, maximum: 100 },
    contactName: { type: "string" },
    contactPhone: { type: "string" },
  },
  required: ["language"],
  additionalProperties: false,
};

const knowledgeSchema = {
  type: "object",
  properties: Object.fromEntries(
    [
      "overview",
      "developerInformation",
      "location",
      "amenities",
      "nearbyPlaces",
      "investmentPoints",
      "targetCustomer",
      "masterPlan",
      "facilities",
      "paymentInformation",
      "salesPoints",
      "faqs",
    ].map((name) => [name, { type: "array", items: { type: "string" } }]),
  ),
  additionalProperties: false,
};

const columnMappingSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      sourceColumn: { type: "string" },
      canonicalField: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      explanation: { type: "string" },
    },
    required: ["sourceColumn", "canonicalField", "confidence"],
    additionalProperties: false,
  },
};

export function classifyGeminiError(error: unknown): GeminiErrorDetails {
  const status =
    error instanceof ApiError
      ? error.status
      : typeof (error as { status?: unknown })?.status === "number"
        ? (error as { status: number }).status
        : 0;
  const message =
    error instanceof Error
      ? error.message
      : typeof (error as { message?: unknown })?.message === "string"
        ? (error as { message: string }).message
        : String(error);
  const normalized = message.toLowerCase();
  const creditsDepleted =
    normalized.includes("prepayment credits") &&
    normalized.includes("depleted");
  const category: GeminiErrorCategory =
    status === 400
      ? "INVALID_ARGUMENT"
      : status === 401 || status === 403
        ? "AUTHENTICATION_OR_PERMISSION"
        : status === 404
          ? "MODEL_OR_ENDPOINT_NOT_FOUND"
          : status === 429
            ? "RESOURCE_EXHAUSTED"
            : status === 500
              ? "INTERNAL"
              : status === 503
                ? "UNAVAILABLE"
                : "UNKNOWN";
  return {
    status,
    category,
    message,
    creditsDepleted,
    retryable:
      !creditsDepleted && (status === 429 || status === 500 || status === 503),
  };
}

export function selectFlashModel(models: GeminiModelInfo[]): string | undefined {
  const supported = models.filter(
    (model) =>
      model.supportedGenerationMethods.includes(GEMINI_GENERATION_METHOD) &&
      /gemini.*flash/i.test(model.name) &&
      !/(image|audio|tts|live|computer)/i.test(model.name),
  );
  return (
    supported.find((model) => model.name === FLASH_ALIAS)?.name ??
    supported.find((model) => model.name.endsWith(`/${FLASH_ALIAS}`))?.name ??
    supported[0]?.name
  )?.replace(/^models\//, "");
}

@Injectable()
export class GeminiProvider implements AIProvider {
  private readonly logger = new Logger(GeminiProvider.name);
  private readonly key = process.env.GEMINI_API_KEY ?? "";
  readonly configuredModel = this.normalizeModel(
    process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
  );
  private activeModel = this.configuredModel;
  private readonly client = new GoogleGenAI({
    apiKey: this.key,
    apiVersion: GEMINI_API_VERSION,
  });
  private modelCache?: { expiresAt: number; models: GeminiModelInfo[] };

  private normalizeModel(model: string) {
    return model.trim().replace(/^models\//, "");
  }

  get selectedModel() {
    return this.activeModel;
  }

  validateConfiguration() {
    if (!this.key) throw new Error("AI_PROVIDER=gemini requires GEMINI_API_KEY");
    if (!this.configuredModel)
      throw new Error("AI_PROVIDER=gemini requires GEMINI_MODEL");
  }

  async listModels(): Promise<GeminiModelInfo[]> {
    if (this.modelCache && this.modelCache.expiresAt > Date.now())
      return this.modelCache.models;
    const pager = await this.client.models.list({ config: { pageSize: 100 } });
    const models: GeminiModelInfo[] = [];
    for await (const model of pager) {
      if (!model.name) continue;
      models.push({
        name: this.normalizeModel(model.name),
        supportedGenerationMethods: model.supportedActions ?? [],
      });
    }
    this.modelCache = { expiresAt: Date.now() + 5 * 60_000, models };
    return models;
  }

  private safeMessage(message: string) {
    const withoutKey = this.key ? message.split(this.key).join("[REDACTED]") : message;
    return withoutKey
      .replace(/([?&]key=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(x-goog-api-key["':=\s]+)[^,\s}]+/gi, "$1[REDACTED]")
      .slice(0, 800);
  }

  private logError(
    details: GeminiErrorDetails,
    model: string,
    method: string,
    requestId: string,
  ) {
    this.logger.error(
      `GeminiError status=${details.status || "NETWORK"} category=${details.category} model=${model} apiVersion=${GEMINI_API_VERSION} method=${method} requestId=${requestId} creditsDepleted=${details.creditsDepleted} message=${this.safeMessage(details.message)}`,
    );
  }

  private exception(details: GeminiErrorDetails, requestId: string) {
    return new ServiceUnavailableException({
      code: "AI_TEMPORARILY_UNAVAILABLE",
      category: details.category,
      upstreamStatus: details.status || undefined,
      requestId,
    });
  }

  private async fallbackAfterNotFound(failedModel: string) {
    try {
      const fallback = selectFlashModel(await this.listModels());
      if (!fallback || fallback === failedModel) return undefined;
      this.activeModel = fallback;
      this.logger.warn(
        `GeminiModelFallback configuredModel=${this.configuredModel} failedModel=${failedModel} selectedModel=${fallback} apiVersion=${GEMINI_API_VERSION}`,
      );
      return fallback;
    } catch (error) {
      const details = classifyGeminiError(error);
      this.logger.error(
        `GeminiModelDiscoveryError status=${details.status || "NETWORK"} category=${details.category} message=${this.safeMessage(details.message)}`,
      );
      return undefined;
    }
  }

  private async execute<T>(
    method: "generateContent" | "streamGenerateContent",
    operation: (model: string) => Promise<T>,
  ): Promise<T> {
    const requestId = randomUUID();
    let model = this.activeModel;
    try {
      return await operation(model);
    } catch (error) {
      let details = classifyGeminiError(error);
      if (details.status === 404) {
        const fallback = await this.fallbackAfterNotFound(model);
        if (fallback) {
          model = fallback;
          try {
            return await operation(model);
          } catch (fallbackError) {
            details = classifyGeminiError(fallbackError);
            this.logError(details, model, method, requestId);
            throw this.exception(details, requestId);
          }
        }
      }
      if (details.retryable) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
          return await operation(model);
        } catch (retryError) {
          details = classifyGeminiError(retryError);
        }
      }
      this.logError(details, model, method, requestId);
      throw this.exception(details, requestId);
    }
  }

  private structuredConfig(schema: unknown) {
    return {
      responseMimeType: "application/json",
      responseJsonSchema: schema,
      temperature: 0.1,
    };
  }

  private parseJson<T>(text: string | undefined, context: string): T {
    if (!text?.trim())
      throw new ServiceUnavailableException(`Gemini returned no ${context}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ServiceUnavailableException(
        `Gemini returned invalid structured ${context}`,
      );
    }
  }

  async extractIntent(
    messages: AIMessage[],
    previous: StructuredIntent,
  ): Promise<StructuredIntent> {
    const prompt = `You extract Egyptian real-estate conversation state. Support English, Arabic, Egyptian Arabic, mixed language and Arabizi. Merge the newest message into previous state; retain unchanged requirements. Never infer a financial or property fact not stated by the customer. Return JSON only.\nPrevious state: ${JSON.stringify(previous)}\nConversation: ${JSON.stringify(messages.slice(-12))}`;
    const response = await this.execute("generateContent", (model) =>
      this.client.models.generateContent({
        model,
        contents: prompt,
        config: this.structuredConfig(intentSchema),
      }),
    );
    const extracted = this.parseJson<StructuredIntent>(
      response.text,
      "intent",
    );
    return {
      ...previous,
      requestedMedia: undefined,
      exactRouteRequested: undefined,
      routeOrigin: undefined,
      routeDestination: undefined,
      ...extracted,
    };
  }

  private answerRequest({
    messages,
    intent,
    verifiedFacts,
    approvedKnowledge = [],
  }: AnswerInput) {
    const systemInstruction = `You are Maqar, a concise and persuasive Egyptian property advisor. Answer in the customer's language and tone. You may ONLY state property availability, prices, areas, bedrooms, delivery, payment details, locations and project claims present in VERIFIED_FACTS or APPROVED_KNOWLEDGE. If data is absent, say you do not have it. Never create unit facts. Do not mention internal tools. If no exact results exist, ask permission before violating hard requirements. Keep the response conversational and mobile-friendly.`;
    return {
      contents: `CONVERSATION=${JSON.stringify(messages.slice(-12))}\nSTATE=${JSON.stringify(intent)}\nVERIFIED_FACTS=${JSON.stringify(verifiedFacts)}\nAPPROVED_KNOWLEDGE=${JSON.stringify(approvedKnowledge)}`,
      config: { systemInstruction, temperature: 0.35, maxOutputTokens: 900 },
    };
  }

  async composeAnswer(input: AnswerInput) {
    const request = this.answerRequest(input);
    const response = await this.execute("generateContent", (model) =>
      this.client.models.generateContent({ model, ...request }),
    );
    return (
      response.text?.trim() ||
      "I don’t have enough verified information to answer that yet."
    );
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    const request = this.answerRequest(input);
    const stream = await this.execute("streamGenerateContent", (model) =>
      this.client.models.generateContentStream({ model, ...request }),
    );
    for await (const chunk of stream) if (chunk.text) yield chunk.text;
  }

  async extractKnowledge(sourceText: string) {
    const prompt = `Extract only facts explicitly present in this real-estate project source. Return structured JSON. No inference. Omit categories with no source facts. Source:\n${sourceText.slice(0, 80_000)}`;
    const response = await this.execute("generateContent", (model) =>
      this.client.models.generateContent({
        model,
        contents: prompt,
        config: this.structuredConfig(knowledgeSchema),
      }),
    );
    return this.parseJson<Record<string, unknown>>(
      response.text,
      "project knowledge",
    );
  }

  async mapColumns(
    headers: string[],
    sampleRows: unknown[][],
    canonicalFields: string[],
  ) {
    const prompt = `Map unknown real-estate spreadsheet columns to canonical fields. Never assume currency, price meaning, financial terms, availability, or delivery when ambiguous. Use only canonical fields supplied. Unknown columns should be omitted.\nHEADERS=${JSON.stringify(headers)}\nSAMPLES=${JSON.stringify(sampleRows.slice(0, 5))}\nCANONICAL=${JSON.stringify(canonicalFields)}`;
    const response = await this.execute("generateContent", (model) =>
      this.client.models.generateContent({
        model,
        contents: prompt,
        config: this.structuredConfig(columnMappingSchema),
      }),
    );
    const parsed = this.parseJson<
      Array<{
        sourceColumn: string;
        canonicalField: string;
        confidence: number;
        explanation?: string;
      }>
    >(response.text, "column mappings");
    return Array.isArray(parsed) ? parsed : [];
  }

  async health() {
    this.validateConfiguration();
    try {
      const models = await this.listModels();
      const configured = models.find(
        (model) => model.name === this.configuredModel,
      );
      try {
        await this.execute("generateContent", (model) =>
          this.client.models.generateContent({
            model,
            contents: "Reply with OK.",
            config: { maxOutputTokens: 8, temperature: 0 },
          }),
        );
        return {
          provider: "gemini",
          configuredModel: this.configuredModel,
          selectedModel: this.activeModel,
          apiVersion: GEMINI_API_VERSION,
          modelAvailable: Boolean(configured),
          generationSupported: Boolean(
            configured?.supportedGenerationMethods.includes(
              GEMINI_GENERATION_METHOD,
            ),
          ),
          status: "ok",
        };
      } catch (error) {
        const response =
          error instanceof ServiceUnavailableException
            ? (error.getResponse() as Record<string, unknown>)
            : {};
        return {
          provider: "gemini",
          configuredModel: this.configuredModel,
          selectedModel: this.activeModel,
          apiVersion: GEMINI_API_VERSION,
          modelAvailable: Boolean(configured),
          generationSupported: Boolean(
            configured?.supportedGenerationMethods.includes(
              GEMINI_GENERATION_METHOD,
            ),
          ),
          status: "unavailable",
          errorCategory: response.category ?? "UNKNOWN",
          upstreamStatus: response.upstreamStatus,
        };
      }
    } catch (error) {
      const details = classifyGeminiError(error);
      return {
        provider: "gemini",
        configuredModel: this.configuredModel,
        selectedModel: this.activeModel,
        apiVersion: GEMINI_API_VERSION,
        modelAvailable: false,
        generationSupported: false,
        status: "unavailable",
        errorCategory: details.category,
        upstreamStatus: details.status || undefined,
      };
    }
  }
}
