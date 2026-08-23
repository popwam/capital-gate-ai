import { Injectable } from "@nestjs/common";
import { AIHealth, AIMessage, AIProvider, AnswerInput, StructuredIntent } from "./ai-provider";
import { AIUpstreamError, advisorMessages, checkedJson, parseJsonArray, parseJsonObject, sanitizeIntent } from "./provider-utils";

@Injectable()
export class CloudflareWorkersAIProvider implements AIProvider {
  private readonly accountId = process.env.CLOUDFLARE_AI_ACCOUNT_ID ?? "";
  private readonly token = process.env.CLOUDFLARE_AI_API_TOKEN ?? "";
  readonly primaryModel = process.env.CLOUDFLARE_AI_MODEL ?? "@cf/openai/gpt-oss-120b";
  readonly fastModel = process.env.CLOUDFLARE_AI_FAST_MODEL ?? "@cf/meta/llama-4-scout-17b-16e-instruct";

  validateConfiguration() {
    if (!this.accountId) throw new Error("CLOUDFLARE_AI_ACCOUNT_ID is required");
    if (!this.token) throw new Error("CLOUDFLARE_AI_API_TOKEN is required");
  }

  private endpoint(model: string) {
    return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(this.accountId)}/ai/run/${model.split("/").map(encodeURIComponent).join("/")}`;
  }

  private async run(model: string, messages: AIMessage[], options: Record<string, unknown> = {}) {
    let response: Response;
    try {
      response = await fetch(this.endpoint(model), {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify({ messages, temperature: 0.1, max_tokens: 1600, ...options }),
        signal: AbortSignal.timeout(35_000),
      });
    } catch { throw new AIUpstreamError("workers", "NETWORK", undefined, true); }
    const body = await checkedJson(response, "workers");
    if (body.success === false) throw new AIUpstreamError("workers", "UPSTREAM_REJECTED", response.status, response.status >= 500);
    const text = body.result?.response ?? body.result?.choices?.[0]?.message?.content ?? body.response;
    if (typeof text !== "string" || !text.trim()) throw new AIUpstreamError("workers", "EMPTY_RESPONSE", 502);
    return text.trim();
  }

  private structuredPrompt(task: string, input: unknown) {
    return [{ role: "system" as const, content: `${task} Return strict JSON only. Do not infer facts that are absent.` }, { role: "user" as const, content: JSON.stringify(input) }];
  }

  async extractIntent(messages: AIMessage[], previous: StructuredIntent) {
    const raw = await this.run(this.fastModel, this.structuredPrompt(
      "Extract PATCH-like updates to Egyptian real-estate conversation state. Understand Egyptian Arabic, MSA, English, mixed Arabic/English, and Arabizi. Missing fields mean PRESERVE. Explicit removal, forgetting, relaxation, or reset MUST be represented in constraintOperations as {operation:REMOVE|RESET|BROADEN,constraint:BUDGET|PURPOSE|PROPERTY_TYPE|LOCATION|BEDROOMS|AREA|PROJECT|DEVELOPER|PAYMENT|DELIVERY|PROXIMITY|SEARCH}; never encode removal by merely omitting a field. Ranking requests use queryObjective CHEAPEST|MOST_EXPENSIVE|BEST_MATCH and are not filters. مساحة/المساحات/متر mean UNIT built-up area unless geography is explicit; منطقة/مناطق/مكان/لوكيشن mean location. New explicit corrections replace conflicts; an informational question must not erase prior filters. Keep rejections separately. Extract language, dialect, purpose, inventoryMarket (PRIMARY|RESALE), locations, rejectedLocations, propertyTypes, bedrooms, bathrooms, budgetMin, budgetMax, budgetFlexible, currency, deliveryMaxYears, maxDownPayment, maxTravelMinutes, builtUpAreaMin, builtUpAreaMax, targetBuiltUpArea, preferredFloor, minimumFloor, maximumFloor, preferredPhase, preferredProjectZone, preferredBuilding, preferredGate, maxGateDistanceMeters, preferredPaymentDurationMonths, maxMonthlyInstallment, preferredDownPaymentPercent, proximityPreferences, hardRequirements, softPreferences, requestedMedia, requestedProject, exactRouteRequested, routeOrigin, routeDestination, purchaseIntent 0-100, contactName, contactPhone, preferredContactChannel (CALL|WHATSAPP), preferredConfirmationChannel (CALL|WHATSAPP), preferredVisitDayPart (MORNING|AFTERNOON|EVENING), preferredVisitTiming (MIDWEEK|WEEKEND|WEEKDAY), rejectedProjects, preferredDevelopers, preferredProjects, familyRequirements, investmentRequirements, customerConcerns. For proximityPreferences use an array of {targetType:GATE|AMENITY|LANDMARK|PROJECT_CENTER,targetName?,preference:NEAR|FAR|ANY,maxDistanceMeters?}. Never assume a project has one gate; a compound can have zero, one, or many gates. If the customer says بوابة 2/Gate 2 extract preferredGate and a GATE proximity preference. Payment-plan duration is months; convert 8 years to 96 months. A request like مقدم مليون means maxDownPayment when it is a ceiling, and قسط شهري لا يزيد عن means maxMonthlyInstallment.",
      { previous, messages: messages.slice(-10) },
    ));
    return sanitizeIntent(parseJsonObject(raw, "workers"), previous);
  }

  async composeAnswer(input: AnswerInput) { return this.run(this.primaryModel, advisorMessages(input), { temperature: 0.2, max_tokens: 1000 }); }
  async *streamAnswer(input: AnswerInput): AsyncIterable<string> { yield await this.composeAnswer(input); }

  async extractKnowledge(sourceText: string) {
    const text = await this.run(this.fastModel, this.structuredPrompt("Extract only explicit project facts into arrays keyed by overview, developerInformation, location, amenities, nearbyPlaces, investmentPoints, targetCustomer, masterPlan, facilities, paymentInformation, delivery, finishing, salesPoints, objections, restrictions, and faqs. Every array item must be an object with content, an exact short sourceExcerpt, and confidence from 0 to 1. Never infer.", sourceText.slice(0, 80_000)));
    return parseJsonObject(text, "workers");
  }

  async mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]) {
    const text = await this.run(this.fastModel, this.structuredPrompt("Map unambiguous real-estate spreadsheet columns. Return an array of sourceColumn, canonicalField, confidence 0-1, explanation. Omit unknown fields and never assume currency or financial semantics.", { headers, sampleRows: sampleRows.slice(0, 5), canonicalFields }));
    return parseJsonArray(text, "workers").filter((item): item is { sourceColumn: string; canonicalField: string; confidence: number; explanation?: string } => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.sourceColumn === "string" && typeof value.canonicalField === "string" && canonicalFields.includes(value.canonicalField) && typeof value.confidence === "number";
    });
  }

  async health(): Promise<AIHealth> {
    if (!this.accountId || !this.token) return { provider: "workers", configured: false, healthy: false, model: this.fastModel, errorCode: "NOT_CONFIGURED" };
    try { await this.run(this.fastModel, [{ role: "user", content: "Reply with OK." }], { max_tokens: 4, temperature: 0 }); return { provider: "workers", configured: true, healthy: true, model: this.fastModel }; }
    catch (error) { return { provider: "workers", configured: true, healthy: false, model: this.fastModel, errorCode: error instanceof AIUpstreamError ? error.code : "NETWORK" }; }
  }
}
