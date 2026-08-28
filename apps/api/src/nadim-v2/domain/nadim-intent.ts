import { z } from "zod";

export const NADIM_INTENTS = [
  "GREETING", "ASSISTANT_IDENTITY", "ASSISTANT_NATURE", "ASSISTANT_CAPABILITIES", "LANGUAGE_CAPABILITY_QUERY", "LANGUAGE_STYLE_CHANGE",
  "PROPERTY_SEARCH", "MODIFY_SEARCH", "COMPARISON", "PROPERTY_QUESTION",
  "PRICE_QUESTION", "PAYMENT_PLAN_QUESTION", "MEDIA_REQUEST", "LOCATION_QUESTION",
  "AVAILABILITY_QUESTION", "LEAD_REQUEST", "CALLBACK_REQUEST", "VIEWING_REQUEST",
  "RESERVATION_REQUEST", "HUMAN_HANDOFF", "RESET_SEARCH", "CURRENT_SEARCH_QUERY",
  "CONVERSATION", "SMALL_TALK", "CORRECTION", "UNKNOWN",
] as const;
export type NadimIntentType = (typeof NADIM_INTENTS)[number];

export const NADIM_CONVERSATIONAL_TYPES = [
  "CONVERSATION", "DISCOVERY", "REACTION", "ACKNOWLEDGEMENT", "STRUCTURED_REQUEST", "CLARIFICATION",
] as const;
export type NadimConversationalType = (typeof NADIM_CONVERSATIONAL_TYPES)[number];

export const NADIM_CLASSIFICATION_SOURCES = [
  "DETERMINISTIC_EXPLICIT", "DETERMINISTIC_GIBBERISH", "DETERMINISTIC_SAFE_FALLBACK",
  "MODEL_SEMANTIC", "MODEL_STRUCTURED", "MODEL_REJECTED",
] as const;

export const STATE_FIELDS = [
  "locations", "projects", "developers", "propertyTypes", "bedrooms", "bathrooms",
  "areaMin", "areaMax", "budgetMin", "budgetMax", "currency", "downPaymentMax",
  "installmentMonths", "installmentPreference", "deliveryMaxYears", "purpose", "finishing", "queryObjective",
] as const;
export type StateField = (typeof STATE_FIELDS)[number];
export type StateOperation = { operation: "SET" | "REMOVE" | "RESET" | "PRESERVE"; field?: StateField | "SEARCH"; value?: unknown };
export const CURRENT_SEARCH_QUERY_TARGETS = [...STATE_FIELDS, "SEARCH", "SELECTED_RESULT"] as const;
export type CurrentSearchQueryTarget = (typeof CURRENT_SEARCH_QUERY_TARGETS)[number];

const OperationSchema = z.object({
  operation: z.enum(["SET", "REMOVE", "RESET", "PRESERVE"]),
  field: z.enum([...STATE_FIELDS, "SEARCH"]).optional(),
  value: z.unknown().optional(),
}).strict();

const ReferenceResolutionSchema = z.object({
  expression: z.string().min(1).max(100),
  resolvedAs: z.enum(["ACTIVE_SEARCH", "SEARCH_BUDGET", "SELECTED_UNIT", "SELECTED_PROJECT", "RECENT_RESULT", "RECENT_DIALOGUE", "CUSTOMER_CONTEXT", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1),
}).strict();

export const NadimSemanticInterpretationSchema = z.object({
  understood: z.boolean(),
  understoodMeaning: z.string().min(1).max(500),
  responseGoal: z.string().min(1).max(160),
  conversationalType: z.enum(NADIM_CONVERSATIONAL_TYPES),
  proposedIntent: z.enum(NADIM_INTENTS).nullish(),
  proposedStateOperations: z.array(OperationSchema).max(30).default([]),
  references: z.array(ReferenceResolutionSchema).max(8).default([]),
  toolNeed: z.object({
    required: z.boolean(),
    kind: z.string().min(1).max(80).nullish(),
    reason: z.string().min(1).max(300).nullish(),
  }).strict(),
  clarification: z.object({
    required: z.boolean(),
    reason: z.string().min(1).max(300).nullish(),
  }).strict(),
  confidence: z.number().min(0).max(1),
  locale: z.string().max(35).nullish(),
  stateQuery: z.enum(CURRENT_SEARCH_QUERY_TARGETS).nullish(),
  ordinalReferences: z.array(z.number().int().min(1).max(20)).max(5).default([]),
  unitReference: z.string().max(120).nullish(),
  projectReference: z.string().max(200).nullish(),
  recentContextUsed: z.boolean().default(false),
}).strict();

export type NadimSemanticInterpretation = z.infer<typeof NadimSemanticInterpretationSchema>;

export const NadimUnderstandingSchema = z.object({
  intent: z.enum(NADIM_INTENTS),
  confidence: z.number().min(0).max(1),
  locale: z.string().max(35).optional(),
  operations: z.array(OperationSchema).max(30).default([]),
  ordinalReferences: z.array(z.number().int().min(1).max(20)).max(5).default([]),
  unitReference: z.string().max(120).optional(),
  projectReference: z.string().max(200).optional(),
  actionRequested: z.boolean().default(false),
  stateQuery: z.enum(CURRENT_SEARCH_QUERY_TARGETS).optional(),
  ambiguity: z.string().max(300).optional(),
  responseGoal: z.string().max(220).optional(),
  responsePlan: z.array(z.string().min(1).max(240)).max(8).optional(),
  references: z.array(ReferenceResolutionSchema).max(8).optional(),
  needsTool: z.boolean().optional(),
  needsClarification: z.boolean().optional(),
  clarificationReason: z.string().max(300).optional(),
  understoodMeaning: z.string().max(500).optional(),
  recentContextUsed: z.boolean().optional(),
  understood: z.boolean().optional(),
  conversationalType: z.enum(NADIM_CONVERSATIONAL_TYPES).optional(),
  classificationSource: z.enum(NADIM_CLASSIFICATION_SOURCES).optional(),
  unknownReason: z.string().max(300).optional(),
  proposedToolCalls: z.array(z.object({
    tool: z.string().min(1).max(80),
    arguments: z.record(z.unknown()).default({}),
    reason: z.string().max(240).optional(),
  }).strict()).max(4).optional(),
  proposedActions: z.array(z.object({
    type: z.string().min(1).max(80),
    reason: z.string().max(240),
    payload: z.record(z.unknown()).default({}),
  }).strict()).max(4).optional(),
  customerContextUpdates: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
  stateQueries: z.array(z.enum(CURRENT_SEARCH_QUERY_TARGETS)).max(12).optional(),
  responseStyleRequest: z.object({
    style: z.enum(["AR_EGYPTIAN", "AR_GULF", "AR_FORMAL", "EN_US", "FRANCO_ARABIC", "MIXED_AR_EN", "UNKNOWN"]),
    regionalVariant: z.enum(["SAUDI"]).nullish(),
  }).strict().nullish(),
}).strict();

export type NadimUnderstanding = z.infer<typeof NadimUnderstandingSchema>;
