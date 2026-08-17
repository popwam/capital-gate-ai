export type AIMessage = { role: "user" | "assistant" | "system"; content: string };

export type CustomerTurnIntent =
  | "SMALL_TALK" | "PROPERTY_SEARCH" | "PROPERTY_REFINEMENT" | "PROPERTY_OPTIONS_REQUEST"
  | "PROPERTY_DETAILS" | "PROJECT_DETAILS" | "DEVELOPER_DETAILS" | "INVENTORY_COUNT"
  | "INVENTORY_AGGREGATION" | "PRICE_AGGREGATION" | "AREA_AGGREGATION"
  | "UNIT_TYPE_AGGREGATION" | "MEDIA_REQUEST" | "BROCHURE_REQUEST" | "LOCATION_REQUEST"
  | "DISTANCE_REQUEST" | "VIEWING_REQUEST" | "CONTACT_REQUEST" | "COMPARISON"
  | "INVESTMENT" | "RESALE" | "RENTAL" | "PAYMENT_PLAN" | "AVAILABILITY_CHECK"
  | "FOLLOW_UP_CONFIRMATION" | "UNKNOWN";

export type ProximityPreference = {
  targetType: "GATE" | "AMENITY" | "LANDMARK" | "PROJECT_CENTER";
  targetId?: string;
  targetName?: string;
  preference: "NEAR" | "FAR" | "ANY";
  maxDistanceMeters?: number;
};

export type PresentationState = {
  searchCandidateIds?: string[];
  selectedProjectId?: string;
  selectedUnitId?: string;
  presentedUnitIds?: string[];
  lastPresentedUnitIds?: string[];
  lastReferencedEntity?: { type: "PROJECT" | "UNIT"; id: string };
  lastOfferedAction?: "PROPERTY_CARDS" | "PROJECT_BROCHURE" | "SEARCH_WIDEN" | "CONTACT_REQUEST";
  awaitingConfirmation?: boolean;
};

export type StructuredIntent = {
  language: string;
  dialect?: "EGYPTIAN_ARABIC" | "MSA" | "ENGLISH" | "MIXED";
  purpose?: "LIVING" | "INVESTMENT";
  inventoryMarket?: "PRIMARY" | "RESALE";
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
  budgetFlexible?: boolean;
  priceTarget?: number;
  priceMin?: number;
  priceMax?: number;
  budgetFlexibility?: "NONE" | "LOW" | "SOFT" | "HIGH";
  explicitRejectedPriceMin?: number;
  explicitRejectedPriceMax?: number;
  rejectedLocations?: string[];
  rejectedProjects?: string[];
  preferredDevelopers?: string[];
  preferredProjects?: string[];
  minimumArea?: number;
  maximumArea?: number;
  builtUpAreaMin?: number;
  builtUpAreaMax?: number;
  targetBuiltUpArea?: number;
  preferredFloor?: number;
  minimumFloor?: number;
  maximumFloor?: number;
  preferredPhase?: string;
  preferredProjectZone?: string;
  preferredBuilding?: string;
  preferredGate?: string;
  maxGateDistanceMeters?: number;
  preferredPaymentDurationMonths?: number;
  maxMonthlyInstallment?: number;
  preferredDownPaymentPercent?: number;
  proximityPreferences?: ProximityPreference[];
  temporaryIntent?: "INVENTORY_AGGREGATION";
  aggregationDimension?: "COUNT" | "BUILT_UP_AREA" | "PRICE" | "LOCATION" | "PROJECT" | "DEVELOPER" | "UNIT_TYPE" | "DELIVERY_DATE" | "PAYMENT_DURATION" | "BEDROOM_COUNT";
  turnIntent?: CustomerTurnIntent;
  externalUnitId?: string;
  presentation?: PresentationState;
  familyRequirements?: string[];
  investmentRequirements?: string[];
  customerConcerns?: string[];
  extractionDegraded?: boolean;
};

export type AIContextKind = "PROPERTY_SEARCH" | "PROJECT_DETAILS" | "DEVELOPER_HISTORY" | "INVESTMENT" | "RESALE" | "RENTAL" | "AMENITIES" | "MEDIA_REQUEST" | "BROCHURE_REQUEST" | "DISTANCE" | "COMPARISON" | "AGGREGATION";
export type AnswerInput = { messages: AIMessage[]; intent: StructuredIntent; verifiedFacts: unknown[]; approvedKnowledge?: unknown[]; conversationSummary?: unknown; contextKind?: AIContextKind; candidatesBeforeRanking?: number; compactionLevel?: "normal" | "aggressive"; requestId?: string; conversationId?: string };
export type AIHealth = { provider: string; configured: boolean; healthy: boolean; model: string | null; errorCode?: string };
export type AITraceContext = { requestId?: string; conversationId?: string };

export interface AIProvider {
  extractIntent(messages: AIMessage[], previous: StructuredIntent, context?: AITraceContext): Promise<StructuredIntent>;
  composeAnswer(input: AnswerInput): Promise<string>;
  streamAnswer(input: AnswerInput): AsyncIterable<string>;
  extractKnowledge(sourceText: string): Promise<Record<string, unknown>>;
  mapColumns(headers: string[], sampleRows: unknown[][], canonicalFields: string[]): Promise<Array<{ sourceColumn: string; canonicalField: string; confidence: number; explanation?: string }>>;
  health?(): Promise<AIHealth | AIHealth[]>;
}
