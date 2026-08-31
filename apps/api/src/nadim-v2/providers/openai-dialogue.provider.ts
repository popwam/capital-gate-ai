import { DialogueHealth, DialogueMessage, DialogueProvider, DialogueProviderError } from "./dialogue-provider";

type ChatResponse = { choices?: Array<{ message?: { content?: string }; delta?: { content?: string } }> };

export abstract class OpenAICompatibleDialogueProvider implements DialogueProvider {
  abstract readonly provider: string;
  abstract readonly model: string;
  protected abstract readonly endpoint: string;
  protected abstract readonly apiKey: string;
  abstract enabled(): boolean;

  configured() {
    return Boolean(this.apiKey && this.model && this.endpoint);
  }

  protected async request(messages: DialogueMessage[], options: { stream?: boolean; jsonMode?: boolean } = {}) {
    if (!this.enabled()) throw new DialogueProviderError(this.provider, "DISABLED", false);
    if (!this.configured()) throw new DialogueProviderError(this.provider, "NOT_CONFIGURED", false);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options.jsonMode ? 0 : 0.2,
          max_tokens: 1_200,
          stream: options.stream ?? false,
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
        }),
        signal: AbortSignal.timeout(options.stream ? 45_000 : 18_000),
      });
    } catch {
      throw new DialogueProviderError(this.provider, "NETWORK");
    }
    if (!response.ok) throw new DialogueProviderError(this.provider, `HTTP_${response.status}`, response.status === 429 || response.status >= 500);
    return response;
  }

  async complete(messages: DialogueMessage[], jsonMode = false) {
    const response = await this.request(messages, { jsonMode });
    const body = await response.json() as ChatResponse;
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) throw new DialogueProviderError(this.provider, "EMPTY_RESPONSE");
    return text;
  }

  async *stream(messages: DialogueMessage[]): AsyncIterable<string> {
    const response = await this.request(messages, { stream: true });
    if (!response.body) throw new DialogueProviderError(this.provider, "EMPTY_STREAM");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const chunk = (JSON.parse(data) as ChatResponse).choices?.[0]?.delta?.content;
          if (chunk) yield chunk;
        } catch {
          // Ignore non-content protocol frames; malformed transport failures surface from the reader.
        }
      }
      if (done) break;
    }
  }

  async health(): Promise<DialogueHealth> {
    const started = Date.now();
    if (!this.enabled()) return { provider: this.provider, enabled: false, configured: this.configured(), healthy: false, model: this.model || null, errorCode: "DISABLED", latencyMs: 0 };
    if (!this.configured()) return { provider: this.provider, enabled: true, configured: false, healthy: false, model: this.model || null, errorCode: "NOT_CONFIGURED", latencyMs: 0 };
    try {
      await this.complete([{ role: "user", content: "Reply with OK." }]);
      return { provider: this.provider, enabled: true, configured: true, healthy: true, model: this.model, latencyMs: Date.now() - started };
    } catch (error) {
      return { provider: this.provider, enabled: true, configured: true, healthy: false, model: this.model, errorCode: error instanceof DialogueProviderError ? error.code : "NETWORK", latencyMs: Date.now() - started };
    }
  }
}
