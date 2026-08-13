import { Logger } from "@nestjs/common";
import { AIHealth, AIMessage, AnswerInput } from "./ai-provider";
import { AIUpstreamError, checkedJson, parseJsonArray, parseJsonObject, ProviderName } from "./provider-utils";
import { answerContextMetrics } from "./ai-context";

export abstract class OpenAICompatibleProvider {
  private readonly logger = new Logger(OpenAICompatibleProvider.name);
  protected abstract readonly providerName: ProviderName;
  protected abstract readonly apiKey: string;
  protected abstract readonly model: string;
  protected abstract readonly endpoint: string;

  validateConfiguration() {
    if (!this.apiKey) throw new Error(`${this.providerName.toUpperCase()}_API_KEY is required`);
    if (!this.model) throw new Error(`${this.providerName.toUpperCase()} model is required`);
  }

  protected async request(messages: AIMessage[], options: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, messages, temperature: 0.2, ...options }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch {
      throw new AIUpstreamError(this.providerName, "NETWORK", undefined, true);
    }
    return checkedJson(response, this.providerName);
  }

  async composeAnswer(input: AnswerInput) {
    const metrics = answerContextMetrics(input, this.model);
    this.traceContext(input, metrics, false);
    const body = await this.request(metrics.messages, { max_tokens: 1000 });
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string" || !text.trim()) throw new AIUpstreamError(this.providerName, "EMPTY_RESPONSE", 502);
    return text.trim();
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    const metrics = answerContextMetrics(input, this.model, true);
    this.traceContext(input, metrics, true);
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, messages: metrics.messages, temperature: 0.2, max_tokens: 1000, stream: true }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch { throw new AIUpstreamError(this.providerName, "NETWORK", undefined, true); }
    if (!response.ok || !response.body) throw new AIUpstreamError(this.providerName, `HTTP_${response.status}`, response.status, response.status === 429 || response.status >= 500);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try { const chunk = JSON.parse(data).choices?.[0]?.delta?.content; if (typeof chunk === "string" && chunk) yield chunk; } catch { /* ignore non-content SSE frames */ }
      }
      if (done) break;
    }
  }

  private traceContext(input:AnswerInput,metrics:ReturnType<typeof answerContextMetrics>,stream:boolean){this.logger.log(`GroqPayloadTrace ${JSON.stringify({requestId:input.requestId??"unknown",conversationId:input.conversationId??"unknown",provider:this.providerName,model:this.model,attempt:input.compactionLevel==="aggressive"?2:1,compacted:input.compactionLevel==="aggressive",stream,messageCount:metrics.messageCount,bodyBytes:metrics.bodyBytes,estimatedInputTokens:metrics.estimatedInputTokens,recentHistoryCount:metrics.recentHistoryCount,resultCount:metrics.resultCount,candidatesBeforeRanking:input.candidatesBeforeRanking??metrics.resultCount,verifiedContextBytes:metrics.verifiedContextBytes})}`);}

  protected async structuredObject(system: string, prompt: string) {
    const body = await this.request([{ role: "system", content: `${system} Return one valid JSON object only.` }, { role: "user", content: prompt }], { temperature: 0.05, response_format: { type: "json_object" } });
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AIUpstreamError(this.providerName, "EMPTY_RESPONSE", 502);
    return parseJsonObject(text, this.providerName);
  }

  protected async structuredArray(system: string, prompt: string) {
    const body = await this.request([{ role: "system", content: `${system} Return one valid JSON array only, without markdown.` }, { role: "user", content: prompt }], { temperature: 0.05 });
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") throw new AIUpstreamError(this.providerName, "EMPTY_RESPONSE", 502);
    return parseJsonArray(text, this.providerName);
  }

  async health(): Promise<AIHealth> {
    if (!this.apiKey || !this.model) return { provider: this.providerName, configured: false, healthy: false, model: this.model || null, errorCode: "NOT_CONFIGURED" };
    try { await this.request([{ role: "user", content: "Reply with OK." }], { max_tokens: 4, temperature: 0 }); return { provider: this.providerName, configured: true, healthy: true, model: this.model }; }
    catch (error) { return { provider: this.providerName, configured: true, healthy: false, model: this.model, errorCode: error instanceof AIUpstreamError ? error.code : "NETWORK" }; }
  }
}
