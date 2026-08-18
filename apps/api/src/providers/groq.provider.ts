import { Injectable } from "@nestjs/common";
import { AIHealth, AIMessage, AIProvider, AnswerInput, StructuredIntent } from "./ai-provider";
import { AIUpstreamError, advisorMessages, parseJsonArray, parseJsonObject, sanitizeIntent } from "./provider-utils";
import { configuredGroqModels } from "./conversation-model-router";

type GroqChatResponse = {
  choices?: Array<{ message?: { content?: string; reasoning?: string }; delta?: { content?: string; reasoning?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; type?: string; code?: string };
};

@Injectable()
export class GroqProvider implements AIProvider {
  private stripReasoning(value: string) {
    // Reasoning tags can span multiple SSE chunks. Keep whitespace intact here;
    // trimming individual chunks corrupts Arabic/English word boundaries.
    return value
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .replace(/<think>[\s\S]*$/gi, "");
  }

  private finalText(value: string) {
    return this.stripReasoning(value).trim();
  }
  private readonly apiKey = process.env.GROQ_API_KEY ?? "";
  private readonly endpoint = "https://api.groq.com/openai/v1/chat/completions";
  readonly defaultModel = configuredGroqModels().general;

  validateConfiguration() {
    if (!this.apiKey) throw new Error("GROQ_API_KEY is required");
  }

  private async request(
    model: string,
    messages: AIMessage[],
    options: { stream?: boolean; temperature?: number; maxTokens?: number; responseFormat?: "json_object" } = {},
  ) {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_completion_tokens: options.maxTokens ?? 1200,
          stream: options.stream ?? false,
          ...(model.startsWith("qwen/") ? { reasoning_effort: "default", include_reasoning: false } : {}),
          ...(model === configuredGroqModels().reasoning && model.startsWith("openai/gpt-oss")
            ? { reasoning_effort: "medium", include_reasoning: false }
            : model.startsWith("openai/gpt-oss")
              ? { reasoning_effort: "low", include_reasoning: false }
              : {}),
          ...(options.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch {
      throw new AIUpstreamError("groq", "NETWORK", undefined, true);
    }

    if (!response.ok) {
      let body: GroqChatResponse | undefined;
      try { body = (await response.json()) as GroqChatResponse; } catch { body = undefined; }
      const status = response.status;
      const upstreamCode = body?.error?.code || body?.error?.type;
      const message = body?.error?.message?.toLowerCase() ?? "";
      const modelUnavailable = status === 404 || upstreamCode === "model_not_found" || /model.+(?:not found|decommission|unavailable|does not exist)/i.test(message);
      const code = modelUnavailable
        ? "MODEL_UNAVAILABLE"
        : status === 413
          ? "HTTP_413"
          : status === 429
            ? "HTTP_429"
            : status >= 500
              ? `HTTP_${status}`
              : upstreamCode || `HTTP_${status}`;
      throw new AIUpstreamError(
        "groq",
        code,
        status,
        modelUnavailable || [408, 409, 413, 422, 424, 429, 498, 499].includes(status) || status >= 500,
      );
    }

    return response;
  }

  async composeAnswerWithModel(input: AnswerInput, model: string) {
    const response = await this.request(model, advisorMessages(input), { temperature: 0.2, maxTokens: 1000 });
    const body = (await response.json()) as GroqChatResponse;
    const content = this.finalText(body.choices?.[0]?.message?.content ?? "");
    if (!content) throw new AIUpstreamError("groq", "EMPTY_RESPONSE", 502, true);
    return content;
  }

  async *streamAnswerWithModel(input: AnswerInput, model: string): AsyncIterable<string> {
    const response = await this.request(model, advisorMessages(input), { stream: true, temperature: 0.2, maxTokens: 1000 });
    if (!response.body) throw new AIUpstreamError("groq", "EMPTY_STREAM", 502, true);

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let rawContent = "";
    let emittedLength = 0;

    const emitVisibleDelta = function* (provider: GroqProvider, chunk: string) {
      rawContent += chunk;
      const visible = provider.stripReasoning(rawContent);
      if (visible.length <= emittedLength) return;
      const delta = visible.slice(emittedLength);
      emittedLength = visible.length;
      if (delta) yield delta;
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const boundary = buffer.indexOf("\n");
          if (boundary < 0) break;
          const rawLine = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          const line = rawLine.trim();
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          let parsed: GroqChatResponse;
          try { parsed = JSON.parse(data) as GroqChatResponse; } catch { continue; }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (typeof chunk === "string" && chunk) {
            yield* emitVisibleDelta(this, chunk);
          }
        }
      }

      const tail = decoder.decode();
      if (tail) buffer += tail;
      // Flush a final non-newline SSE frame if the upstream closes without one.
      const lastLine = buffer.trim();
      if (lastLine.startsWith("data:")) {
        const data = lastLine.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data) as GroqChatResponse;
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (typeof chunk === "string" && chunk) yield* emitVisibleDelta(this, chunk);
          } catch { /* ignore malformed terminal frame */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
    const finalVisible = this.finalText(rawContent);
    if (!finalVisible) throw new AIUpstreamError("groq", "EMPTY_STREAM_RESPONSE", 502, true);
  }

  async composeAnswer(input: AnswerInput) {
    return this.composeAnswerWithModel(input, this.defaultModel);
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    yield* this.streamAnswerWithModel(input, this.defaultModel);
  }

  async extractIntent(messages: AIMessage[], previous: StructuredIntent): Promise<StructuredIntent> {
    const model = configuredGroqModels().general;
    const prompt: AIMessage[] = [
      { role: "system", content: "Extract only explicit PATCH-like updates to Egyptian real-estate state. Return strict JSON only. Never invent values." },
      { role: "user", content: JSON.stringify({ previous, messages: messages.slice(-8) }) },
    ];
    const response = await this.request(model, prompt, { temperature: 0, maxTokens: 700, responseFormat: "json_object" });
    const body = (await response.json()) as GroqChatResponse;
    return sanitizeIntent(parseJsonObject(body.choices?.[0]?.message?.content ?? "{}", "groq"), previous);
  }

  async extractKnowledge(sourceText: string) {
    const model = configuredGroqModels().reasoning;
    const prompt: AIMessage[] = [
      { role: "system", content: "Extract explicit real-estate project facts only. Return strict JSON. Never infer absent claims." },
      { role: "user", content: sourceText.slice(0, 40_000) },
    ];
    const response = await this.request(model, prompt, { temperature: 0, maxTokens: 1400, responseFormat: "json_object" });
    const body = (await response.json()) as GroqChatResponse;
    return parseJsonObject(body.choices?.[0]?.message?.content ?? "{}", "groq");
  }

  async mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]) {
    const model = configuredGroqModels().general;
    const prompt: AIMessage[] = [
      { role: "system", content: "Map only unambiguous real-estate spreadsheet columns. Return JSON array only. Never invent canonical fields." },
      { role: "user", content: JSON.stringify({ headers, sampleRows: sampleRows.slice(0, 5), canonicalFields }) },
    ];
    const response = await this.request(model, prompt, { temperature: 0, maxTokens: 900 });
    const body = (await response.json()) as GroqChatResponse;
    return parseJsonArray(body.choices?.[0]?.message?.content ?? "[]", "groq").filter((item): item is { sourceColumn: string; canonicalField: string; confidence: number; explanation?: string } => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.sourceColumn === "string" && typeof value.canonicalField === "string" && canonicalFields.includes(value.canonicalField) && typeof value.confidence === "number";
    });
  }

  async health(): Promise<AIHealth> {
    if (!this.apiKey) return { provider: "groq", configured: false, healthy: false, model: this.defaultModel, errorCode: "NOT_CONFIGURED" };
    try {
      const response = await this.request(this.defaultModel, [{ role: "user", content: "Reply with OK." }], { temperature: 0, maxTokens: 32 });
      const body = (await response.json()) as GroqChatResponse;
      const content = body.choices?.[0]?.message?.content;
      return { provider: "groq", configured: true, healthy: Boolean(content), model: this.defaultModel, ...(!content ? { errorCode: "EMPTY_RESPONSE" } : {}) };
    } catch (error) {
      return { provider: "groq", configured: true, healthy: false, model: this.defaultModel, errorCode: error instanceof AIUpstreamError ? error.code : "NETWORK" };
    }
  }
}
