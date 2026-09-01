import type { ExecutedAction } from "./nadim-action";
import type { NadimToolResult } from "./nadim-plan";
import type { VerifiedUnitPaymentPlanResult } from "./verified-payment-plan";

export type NadimUiPayload =
  | { type: "PROPERTY_RESULTS"; data: { totalExactMatches: number; returnedCount: number; hasMore: boolean; properties: unknown[] } }
  | { type: "PROPERTY_COMPARISON"; data: { properties: unknown[] } }
  | { type: "MEDIA"; data: { media: unknown[]; location?: unknown } }
  | { type: "LOCATION"; data: { location: unknown } }
  | { type: "PAYMENT_PLANS"; data: VerifiedUnitPaymentPlanResult }
  | { type: "SHARE_LINK"; data: { url: string } }
  | { type: "WHATSAPP_LINK"; data: { url: string } };

export function buildNadimUi(toolResults: NadimToolResult[], actions: ExecutedAction[], options: { includeMediaLocation?: boolean } = {}): NadimUiPayload[] {
  const ui: NadimUiPayload[] = [];
  for (const result of toolResults) {
    if (!result.ok) continue;
    if (result.tool === "PROPERTY_SEARCH" && Array.isArray(result.data) && result.data.length) {
      const returnedCount = result.data.length;
      const totalExactMatches = Math.max(returnedCount, Number(result.metadata?.totalExactMatches ?? returnedCount));
      ui.push({ type: "PROPERTY_RESULTS", data: {
        totalExactMatches,
        returnedCount,
        hasMore: Boolean(result.metadata?.hasMore ?? totalExactMatches > returnedCount),
        properties: result.data,
      } });
    } else if (result.tool === "COMPARE_PROPERTIES" && Array.isArray(result.data) && result.data.length) {
      ui.push({ type: "PROPERTY_COMPARISON", data: { properties: result.data } });
    } else if (result.tool === "GET_MEDIA" && result.data && !Array.isArray(result.data)) {
      const data = result.data as { media?: unknown[]; location?: unknown };
      ui.push({ type: "MEDIA", data: { media: Array.isArray(data.media) ? data.media : [] } });
      if (options.includeMediaLocation && data.location) ui.push({ type: "LOCATION", data: { location: data.location } });
    } else if (result.tool === "GET_LOCATION" && result.data) {
      ui.push({ type: "LOCATION", data: { location: result.data } });
    } else if (result.tool === "GET_PAYMENT_PLAN" && result.data && !Array.isArray(result.data)) {
      const data = result.data as VerifiedUnitPaymentPlanResult;
      if (data.unit?.id && Array.isArray(data.plans)) ui.push({ type: "PAYMENT_PLANS", data });
    }
  }
  for (const action of actions) {
    if (action.status !== "SUCCEEDED" || !action.message) continue;
    if (action.type === "CREATE_CONVERSATION_SHARE_LINK") ui.push({ type: "SHARE_LINK", data: { url: action.message } });
    if (action.type === "CREATE_WHATSAPP_HANDOFF_LINK") ui.push({ type: "WHATSAPP_LINK", data: { url: action.message } });
  }
  return ui;
}
