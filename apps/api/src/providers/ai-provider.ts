export type AIMessage = { role: "user" | "assistant" | "system"; content: string };
export type StructuredIntent = {
  language: string;
  purpose?: "LIVING" | "INVESTMENT";
  locations?: string[];
  propertyTypes?: string[];
  bedrooms?: number;
  bathrooms?: number;
  budgetMin?: number;
  budgetMax?: number;
  currency?: string;
  deliveryMaxYears?: number;
  maxDownPayment?: number;
  maxTravelMinutes?: number;
  hardRequirements?: string[];
  softPreferences?: string[];
  requestedMedia?: "IMAGES" | "BROCHURE" | "MAP";
  requestedProject?: string;
  exactRouteRequested?: boolean;
  routeOrigin?: string;
  routeDestination?: string;
  purchaseIntent?: number;
  contactName?: string;
  contactPhone?: string;
};
export type AnswerInput = { messages: AIMessage[]; intent: StructuredIntent; verifiedFacts: unknown[]; approvedKnowledge?: unknown[] };
export interface AIProvider {
  extractIntent(messages: AIMessage[], previous: StructuredIntent): Promise<StructuredIntent>;
  composeAnswer(input: AnswerInput): Promise<string>;
  streamAnswer(input: AnswerInput): AsyncIterable<string>;
  extractKnowledge(sourceText: string): Promise<Record<string, unknown>>;
  mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]): Promise<Array<{ sourceColumn: string; canonicalField: string; confidence: number; explanation?: string }>>;
}
