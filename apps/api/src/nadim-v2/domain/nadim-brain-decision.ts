import { z } from "zod";
import { NADIM_ACTIONS, NADIM_CONTROL_ACTIONS } from "./nadim-action";
import { CURRENT_SEARCH_QUERY_TARGETS, NADIM_CONVERSATIONAL_TYPES, NADIM_INTENTS, STATE_FIELDS } from "./nadim-intent";
import { NADIM_TOOLS } from "./nadim-plan";
import { NADIM_LANGUAGE_STYLES, NADIM_REGIONAL_VARIANTS } from "../personality/language-style.types";

const StateOperationSchema = z.object({
  operation: z.enum(["SET", "REMOVE", "RESET", "PRESERVE"]),
  field: z.enum([...STATE_FIELDS, "SEARCH"]).optional(),
  value: z.unknown().optional(),
}).strict();

const ReferenceSchema = z.object({
  expression: z.string().min(1).max(100),
  resolvedAs: z.enum(["ACTIVE_SEARCH", "ACTIVE_REQUIREMENT", "PROPERTY_REQUIREMENT", "SEARCH_BUDGET", "SELECTED_UNIT", "SELECTED_PROJECT", "RECENT_RESULT", "RECENT_DIALOGUE", "CUSTOMER_CONTEXT", "UNRESOLVED"]),
  confidence: z.number().min(0).max(1),
}).strict();

export const NadimBrainDecisionSchema = z.object({
  understood: z.boolean(),
  understoodMeaning: z.string().min(1).max(600),
  conversationalGoal: z.string().min(1).max(220),
  responsePlan: z.array(z.string().min(1).max(240)).min(1).max(8),
  conversationalType: z.enum(NADIM_CONVERSATIONAL_TYPES),
  intent: z.enum(NADIM_INTENTS).nullish(),
  references: z.array(ReferenceSchema).max(12).default([]),
  proposedStateOperations: z.array(StateOperationSchema).max(30).default([]),
  proposedToolCalls: z.array(z.object({
    tool: z.enum(NADIM_TOOLS),
    arguments: z.record(z.unknown()).default({}),
    reason: z.string().min(1).max(240),
  }).strict()).max(4).default([]),
  proposedActions: z.array(z.object({
    type: z.enum([...NADIM_ACTIONS, ...NADIM_CONTROL_ACTIONS]),
    reason: z.string().min(1).max(240),
    payload: z.record(z.unknown()).default({}),
  }).strict()).max(4).default([]),
  customerContextUpdates: z.record(z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
  stateQueries: z.array(z.enum(CURRENT_SEARCH_QUERY_TARGETS)).max(12).default([]),
  responseStyleRequest: z.object({
    style: z.enum(NADIM_LANGUAGE_STYLES),
    regionalVariant: z.enum(NADIM_REGIONAL_VARIANTS).nullish(),
  }).strict().nullish(),
  needsClarification: z.boolean(),
  clarificationReason: z.string().max(300).nullish(),
  locale: z.string().max(35).nullish(),
  recentContextUsed: z.boolean().default(false),
  confidence: z.number().min(0).max(1),
}).strict();

export type NadimBrainDecision = z.infer<typeof NadimBrainDecisionSchema>;
