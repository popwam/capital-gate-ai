import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { AIMessage, AIProvider, AnswerInput, StructuredIntent } from "./ai-provider";

type GeminiPart = { text?: string };

@Injectable()
export class GeminiProvider implements AIProvider {
  private readonly key = process.env.GEMINI_API_KEY ?? "";
  private readonly model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  private endpoint(stream = false) {
    const method = stream ? "streamGenerateContent?alt=sse&" : "generateContent?";
    return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:${method}key=${encodeURIComponent(this.key)}`;
  }

  private async request(body: unknown) {
    const response = await fetch(this.endpoint(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    if (!response.ok) throw new ServiceUnavailableException(`Gemini request failed (${response.status})`);
    return response.json() as Promise<any>;
  }

  async extractIntent(messages: AIMessage[], previous: StructuredIntent): Promise<StructuredIntent> {
    const prompt = `You extract Egyptian real-estate conversation state. Support English, Arabic, Egyptian Arabic, mixed language and Arabizi. Merge the newest message into previous state; retain unchanged requirements. Never infer a financial or property fact not stated by the customer. Return JSON only.\nPrevious state: ${JSON.stringify(previous)}\nConversation: ${JSON.stringify(messages.slice(-12))}`;
    const schema = { type: "OBJECT", properties: {
      language: { type: "STRING" }, purpose: { type: "STRING", enum: ["LIVING", "INVESTMENT"] }, locations: { type: "ARRAY", items: { type: "STRING" } }, propertyTypes: { type: "ARRAY", items: { type: "STRING" } }, bedrooms: { type: "INTEGER" }, bathrooms: { type: "INTEGER" }, budgetMin: { type: "NUMBER" }, budgetMax: { type: "NUMBER" }, currency: { type: "STRING" }, deliveryMaxYears: { type: "NUMBER" }, maxDownPayment: { type: "NUMBER" }, maxTravelMinutes: { type: "INTEGER" }, hardRequirements: { type: "ARRAY", items: { type: "STRING" } }, softPreferences: { type: "ARRAY", items: { type: "STRING" } }, requestedMedia: { type: "STRING", enum: ["IMAGES", "BROCHURE", "MAP"] }, requestedProject: { type: "STRING" }, exactRouteRequested: { type: "BOOLEAN" }, routeOrigin: { type: "STRING" }, routeDestination: { type: "STRING" }, purchaseIntent: { type: "INTEGER" }, contactName: { type: "STRING" }, contactPhone: { type: "STRING" }
    }, required: ["language"] };
    const json = await this.request({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: schema, temperature: 0.1 } });
    const text = json.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text ?? "").join("") ?? "{}";
    return { ...previous, requestedMedia: undefined, exactRouteRequested: undefined, routeOrigin: undefined, routeDestination: undefined, ...JSON.parse(text) };
  }

  private answerBody({ messages, intent, verifiedFacts, approvedKnowledge = [] }: AnswerInput) {
    const instruction = `You are Maqar, a concise and persuasive Egyptian property advisor. Answer in the customer's language and tone. You may ONLY state property availability, prices, areas, bedrooms, delivery, payment details, locations and project claims present in VERIFIED_FACTS or APPROVED_KNOWLEDGE. If data is absent, say you do not have it. Never create unit facts. Do not mention internal tools. If no exact results exist, ask permission before violating hard requirements. Keep the response conversational and mobile-friendly.`;
    return { systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: `CONVERSATION=${JSON.stringify(messages.slice(-12))}\nSTATE=${JSON.stringify(intent)}\nVERIFIED_FACTS=${JSON.stringify(verifiedFacts)}\nAPPROVED_KNOWLEDGE=${JSON.stringify(approvedKnowledge)}` }] }], generationConfig: { temperature: 0.35, maxOutputTokens: 900 } };
  }

  async composeAnswer(input: AnswerInput) {
    const json = await this.request(this.answerBody(input));
    return json.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text ?? "").join("")?.trim() || "I don’t have enough verified information to answer that yet.";
  }

  async *streamAnswer(input: AnswerInput): AsyncIterable<string> {
    const response = await fetch(this.endpoint(true), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.answerBody(input)), signal: AbortSignal.timeout(60_000) });
    if (!response.ok || !response.body) throw new ServiceUnavailableException(`Gemini stream failed (${response.status})`);
    const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) { buffer += decoder.decode(); break; }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event.split("\n").find(line => line.startsWith("data:"))?.slice(5).trim();
        if (!data) continue;
        const json = JSON.parse(data);
        const text = json.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text ?? "").join("");
        if (text) yield text;
      }
    }
  }

  async extractKnowledge(sourceText: string) {
    const prompt = `Extract only facts explicitly present in this real-estate project source. Return structured JSON. No inference. Source:\n${sourceText.slice(0, 80_000)}`;
    const json = await this.request({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
    const text = json.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text ?? "").join("") ?? "{}";
    return JSON.parse(text);
  }
  async mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]) {
    const prompt = `Map unknown real-estate spreadsheet columns to canonical fields. Return a JSON array with sourceColumn, canonicalField, confidence 0..1, and explanation. Never assume currency, price meaning, financial terms, availability, or delivery when ambiguous. Use only canonical fields supplied. Unknown columns should be omitted.\nHEADERS=${JSON.stringify(headers)}\nSAMPLES=${JSON.stringify(sampleRows.slice(0, 5))}\nCANONICAL=${JSON.stringify(canonicalFields)}`;
    const json = await this.request({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } });
    const text = json.candidates?.[0]?.content?.parts?.map((p: GeminiPart) => p.text ?? "").join("") ?? "[]";
    const parsed = JSON.parse(text); return Array.isArray(parsed) ? parsed : [];
  }
}
