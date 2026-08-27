import { z } from "zod";

export const NADIM_INTENTS = [
  "GREETING", "ASSISTANT_IDENTITY", "PROPERTY_SEARCH", "MODIFY_SEARCH", "COMPARISON", "PROPERTY_QUESTION",
  "PRICE_QUESTION", "PAYMENT_PLAN_QUESTION", "MEDIA_REQUEST", "LOCATION_QUESTION",
  "AVAILABILITY_QUESTION", "LEAD_REQUEST", "CALLBACK_REQUEST", "VIEWING_REQUEST",
  "RESERVATION_REQUEST", "HUMAN_HANDOFF", "RESET_SEARCH", "CURRENT_SEARCH_QUERY",
  "SMALL_TALK", "CORRECTION", "UNKNOWN",
] as const;
export type NadimIntentType = (typeof NADIM_INTENTS)[number];

export const STATE_FIELDS = [
  "locations", "projects", "developers", "propertyTypes", "bedrooms", "bathrooms",
  "areaMin", "areaMax", "budgetMin", "budgetMax", "currency", "downPaymentMax",
  "installmentMonths", "installmentPreference", "deliveryMaxYears", "purpose", "finishing", "queryObjective",
] as const;
export type StateField = (typeof STATE_FIELDS)[number];
export type StateOperation = { operation: "SET" | "REMOVE" | "RESET" | "PRESERVE"; field?: StateField | "SEARCH"; value?: unknown };
export type CurrentSearchQueryTarget = StateField | "SEARCH";

const OperationSchema = z.object({
  operation: z.enum(["SET", "REMOVE", "RESET", "PRESERVE"]),
  field: z.enum([...STATE_FIELDS, "SEARCH"]).optional(),
  value: z.unknown().optional(),
}).strict();

export const NadimUnderstandingSchema = z.object({
  intent: z.enum(NADIM_INTENTS),
  confidence: z.number().min(0).max(1),
  locale: z.string().max(35).optional(),
  operations: z.array(OperationSchema).max(30).default([]),
  ordinalReferences: z.array(z.number().int().min(1).max(20)).max(5).default([]),
  unitReference: z.string().max(120).optional(),
  projectReference: z.string().max(200).optional(),
  actionRequested: z.boolean().default(false),
  stateQuery: z.enum([...STATE_FIELDS, "SEARCH"]).optional(),
  ambiguity: z.string().max(300).optional(),
}).strict();

export type NadimUnderstanding = z.infer<typeof NadimUnderstandingSchema>;
