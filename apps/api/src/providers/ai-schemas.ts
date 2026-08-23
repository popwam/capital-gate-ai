import { z } from "zod";
import type { StructuredIntent as StructuredIntentType } from "./ai-provider";

/**
 * Runtime validation schemas for AI provider outputs.
 *
 * TypeScript only checks at compile time. These schemas catch malformed
 * model responses (wrong types, out-of-range numbers, unknown enums)
 * before they are consumed downstream.
 *
 * Schemas are derived from the actual `StructuredIntent` type in
 * `ai-provider.ts` — they are not a parallel type system.
 */

// ============================================================================
// Enums matching ai-provider.ts
// ============================================================================

export const CustomerTurnIntentEnum = z.enum([
  "SMALL_TALK",
  "PROPERTY_SEARCH",
  "PROPERTY_REFINEMENT",
  "PROPERTY_OPTIONS_REQUEST",
  "PROPERTY_DETAILS",
  "PROJECT_DETAILS",
  "DEVELOPER_DETAILS",
  "INVENTORY_COUNT",
  "INVENTORY_AGGREGATION",
  "PRICE_AGGREGATION",
  "AREA_AGGREGATION",
  "UNIT_TYPE_AGGREGATION",
  "MEDIA_REQUEST",
  "BROCHURE_REQUEST",
  "LOCATION_REQUEST",
  "DISTANCE_REQUEST",
  "VIEWING_REQUEST",
  "CONTACT_REQUEST",
  "COMPARISON",
  "INVESTMENT",
  "RESALE",
  "RENTAL",
  "PAYMENT_PLAN",
  "AVAILABILITY_CHECK",
  "FOLLOW_UP_CONFIRMATION",
  "OUT_OF_DOMAIN",
  "UNKNOWN",
]);

const DialectEnum = z.enum(["EGYPTIAN_ARABIC", "MSA", "ENGLISH", "MIXED"]);
const PurposeEnum = z.enum(["LIVING", "INVESTMENT"]);
const InventoryMarketEnum = z.enum(["PRIMARY", "RESALE"]);
const RequestedMediaEnum = z.enum(["IMAGES", "BROCHURE", "MAP"]);
const ContactChannelEnum = z.enum(["CALL", "WHATSAPP"]);
const PaymentModeEnum = z.enum(["CASH", "INSTALLMENT"]);
const VisitDayPartEnum = z.enum(["MORNING", "AFTERNOON", "EVENING"]);
const VisitTimingEnum = z.enum(["MIDWEEK", "WEEKEND", "WEEKDAY"]);
const BudgetFlexibilityEnum = z.enum(["NONE", "LOW", "SOFT", "HIGH"]);
const TemporaryIntentEnum = z.enum(["INVENTORY_AGGREGATION"]);
const AggregationDimensionEnum = z.enum([
  "COUNT",
  "BUILT_UP_AREA",
  "PRICE",
  "LOCATION",
  "PROJECT",
  "DEVELOPER",
  "UNIT_TYPE",
  "DELIVERY_DATE",
  "PAYMENT_DURATION",
  "BEDROOM_COUNT",
]);

const ProximityPreferenceSchema = z.object({
  targetType: z.enum(["GATE", "AMENITY", "LANDMARK", "PROJECT_CENTER"]),
  targetId: z.string().optional(),
  targetName: z.string().optional(),
  preference: z.enum(["NEAR", "FAR", "ANY"]),
  maxDistanceMeters: z.number().min(0).optional(),
});

const PresentationStateSchema = z.object({
  searchCandidateIds: z.array(z.string()).optional(),
  selectedProjectId: z.string().optional(),
  selectedUnitId: z.string().optional(),
  presentedUnitIds: z.array(z.string()).optional(),
  lastPresentedUnitIds: z.array(z.string()).optional(),
  lastReferencedEntity: z
    .object({
      type: z.enum(["PROJECT", "UNIT"]),
      id: z.string(),
    })
    .optional(),
  lastOfferedAction: z
    .enum(["PROPERTY_CARDS", "PROJECT_BROCHURE", "SEARCH_WIDEN", "CONTACT_REQUEST"])
    .optional(),
  awaitingConfirmation: z.boolean().optional(),
  leadHandoffStage: z
    .enum(["PAYMENT", "IDENTITY", "CONFIRMATION", "CONTACT_PREFERENCES", "COMPLETE"])
    .optional(),
  conversationClosed: z.boolean().optional(),
  conversationClosedReason: z.string().optional(),
});

// ============================================================================
// StructuredIntent — matches ai-provider.ts
// ============================================================================

/**
 * Partial schema used to validate a raw model payload.
 * Extra keys are stripped. Missing keys stay missing so sanitizeIntent
 * (or the previous-state merge) can fill them.
 *
 * `language` is optional at this layer because the model often omits it;
 * `validateIntent` always supplies a string before returning.
 */
export const StructuredIntentSchema = z.object({
  language: z.string().optional(),
  dialect: DialectEnum.optional(),
  purpose: PurposeEnum.optional(),
  inventoryMarket: InventoryMarketEnum.optional(),
  locations: z.array(z.string()).optional(),
  propertyTypes: z.array(z.string()).optional(),
  bedrooms: z.number().int().min(0).max(20).optional(),
  bathrooms: z.number().int().min(0).max(20).optional(),
  budgetMin: z.number().min(0).optional(),
  budgetMax: z.number().min(0).optional(),
  currency: z.string().optional(),
  deliveryMaxYears: z.number().int().min(0).max(50).optional(),
  maxDownPayment: z.number().min(0).optional(),
  maxTravelMinutes: z.number().int().min(0).max(300).optional(),
  hardRequirements: z.array(z.string()).optional(),
  softPreferences: z.array(z.string()).optional(),
  requestedMedia: RequestedMediaEnum.optional(),
  requestedProject: z.string().optional(),
  exactRouteRequested: z.boolean().optional(),
  routeOrigin: z.string().optional(),
  routeDestination: z.string().optional(),
  purchaseIntent: z.number().int().min(0).max(100).optional(),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  preferredContactChannel: ContactChannelEnum.optional(),
  preferredConfirmationChannel: ContactChannelEnum.optional(),
  preferredPaymentMode: PaymentModeEnum.optional(),
  preferredVisitDayPart: VisitDayPartEnum.optional(),
  preferredVisitTiming: VisitTimingEnum.optional(),
  budgetFlexible: z.boolean().optional(),
  priceTarget: z.number().min(0).optional(),
  priceMin: z.number().min(0).optional(),
  priceMax: z.number().min(0).optional(),
  budgetFlexibility: BudgetFlexibilityEnum.optional(),
  explicitRejectedPriceMin: z.number().optional(),
  explicitRejectedPriceMax: z.number().optional(),
  rejectedLocations: z.array(z.string()).optional(),
  rejectedProjects: z.array(z.string()).optional(),
  preferredDevelopers: z.array(z.string()).optional(),
  preferredProjects: z.array(z.string()).optional(),
  minimumArea: z.number().min(0).optional(),
  maximumArea: z.number().min(0).optional(),
  builtUpAreaMin: z.number().min(0).optional(),
  builtUpAreaMax: z.number().min(0).optional(),
  targetBuiltUpArea: z.number().min(0).optional(),
  preferredFloor: z.number().int().optional(),
  minimumFloor: z.number().int().optional(),
  maximumFloor: z.number().int().optional(),
  preferredPhase: z.string().optional(),
  preferredProjectZone: z.string().optional(),
  preferredBuilding: z.string().optional(),
  preferredGate: z.string().optional(),
  maxGateDistanceMeters: z.number().min(0).optional(),
  preferredPaymentDurationMonths: z.number().int().min(0).max(600).optional(),
  maxMonthlyInstallment: z.number().min(0).optional(),
  preferredDownPaymentPercent: z.number().min(0).max(100).optional(),
  proximityPreferences: z.array(ProximityPreferenceSchema).optional(),
  temporaryIntent: TemporaryIntentEnum.optional(),
  aggregationDimension: AggregationDimensionEnum.optional(),
  turnIntent: CustomerTurnIntentEnum.optional(),
  externalUnitId: z.string().optional(),
  presentation: PresentationStateSchema.optional(),
  familyRequirements: z.array(z.string()).optional(),
  investmentRequirements: z.array(z.string()).optional(),
  customerConcerns: z.array(z.string()).optional(),
  extractionDegraded: z.boolean().optional(),
  constraintOperations: z.array(z.object({
    operation: z.enum(["REMOVE", "RESET", "BROADEN"]),
    constraint: z.enum(["BUDGET", "PURPOSE", "PROPERTY_TYPE", "LOCATION", "BEDROOMS", "AREA", "PROJECT", "DEVELOPER", "PAYMENT", "DELIVERY", "PROXIMITY", "SEARCH"]),
  })).optional(),
  queryObjective: z.enum(["CHEAPEST", "MOST_EXPENSIVE", "BEST_MATCH"]).optional(),
});

// ============================================================================
// Knowledge extraction
// ============================================================================

export const ProjectKnowledgeSchema = z.object({
  overview: z.array(z.unknown()).optional(),
  developerInformation: z.array(z.unknown()).optional(),
  location: z.array(z.unknown()).optional(),
  amenities: z.array(z.unknown()).optional(),
  nearbyPlaces: z.array(z.unknown()).optional(),
  investmentPoints: z.array(z.unknown()).optional(),
  targetCustomer: z.array(z.unknown()).optional(),
  masterPlan: z.array(z.unknown()).optional(),
  facilities: z.array(z.unknown()).optional(),
  paymentInformation: z.array(z.unknown()).optional(),
  delivery: z.array(z.unknown()).optional(),
  finishing: z.array(z.unknown()).optional(),
  salesPoints: z.array(z.unknown()).optional(),
  objections: z.array(z.unknown()).optional(),
  restrictions: z.array(z.unknown()).optional(),
  faqs: z.array(z.unknown()).optional(),
  extractionUnavailable: z.boolean().optional(),
  sourceLength: z.number().optional(),
  summary: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

export type ProjectKnowledge = z.infer<typeof ProjectKnowledgeSchema>;

// ============================================================================
// Column mapping — matches AIProvider.mapColumns return type
// ============================================================================

export const ColumnMappingSchema = z.object({
  sourceColumn: z.string(),
  canonicalField: z.string(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().optional(),
});

export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;

// ============================================================================
// Helpers
// ============================================================================

type LoggerLike = { warn: (message: string) => void };

function formatZodError(error: z.ZodError): string {
  return JSON.stringify({
    errors: error.issues.slice(0, 5).map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
      code: issue.code,
    })),
  });
}

/**
 * Validate a raw model payload against StructuredIntentSchema.
 *
 * On success, returns a StructuredIntent with `language` guaranteed.
 * On failure, logs the first five issues and returns a minimal valid intent
 * so the conversation can continue with deterministic extraction.
 */
export function validateIntent(
  data: unknown,
  logger?: LoggerLike,
  previous?: StructuredIntentType,
): StructuredIntentType {
  const result = StructuredIntentSchema.safeParse(data);

  if (result.success) {
    const parsed = result.data;
    return {
      ...parsed,
      language: parsed.language ?? previous?.language ?? "ar-EG",
    };
  }

  logger?.warn(`Intent validation failed: ${formatZodError(result.error)}`);

  return {
    language: previous?.language ?? "ar-EG",
    extractionDegraded: true,
  };
}

/**
 * Validate knowledge extraction. Falls back to an unavailable marker
 * so the import pipeline can queue the source for manual review.
 */
export function validateKnowledge(
  data: unknown,
  logger?: LoggerLike,
): Record<string, unknown> {
  const result = ProjectKnowledgeSchema.safeParse(data);

  if (result.success) {
    return result.data;
  }

  logger?.warn(`Knowledge extraction validation failed: ${formatZodError(result.error)}`);

  return {
    extractionUnavailable: true,
    notes: "Validation failed, manual review required",
  };
}

/**
 * Validate column mappings. Returns an empty array on failure so the
 * import UI can fall back to manual mapping rather than crash.
 */
export function validateColumnMappings(
  data: unknown,
  logger?: LoggerLike,
): ColumnMapping[] {
  const result = z.array(ColumnMappingSchema).safeParse(data);

  if (result.success) {
    return result.data;
  }

  logger?.warn(`Column mapping validation failed: ${formatZodError(result.error)}`);

  return [];
}
