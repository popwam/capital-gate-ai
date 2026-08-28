export const NADIM_TOOLS = [
  "PROPERTY_SEARCH", "GET_PROJECT_FACTS", "GET_UNIT_FACTS", "GET_PAYMENT_PLAN",
  "GET_AVAILABILITY", "COMPARE_PROPERTIES", "GET_MEDIA", "GET_LOCATION",
  "CUSTOMER_LOOKUP", "LEAD_LOOKUP", "GET_CURRENT_TIME",
] as const;
export type NadimToolName = (typeof NADIM_TOOLS)[number];
export type NadimPlan = {
  goal: string;
  steps: Array<{ tool: NadimToolName; arguments: Record<string, unknown> }>;
  clarification?: string;
};
export type NadimToolResult = {
  tool: NadimToolName;
  ok: boolean;
  data?: unknown;
  errorCode?: string;
  latencyMs: number;
};
