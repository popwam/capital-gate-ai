import type { ExecutedAction } from "./nadim-action";
import type { NadimToolResult } from "./nadim-plan";

export type NadimUiPayload =
  | { type: "PROPERTY_RESULTS"; data: { properties: unknown[] } }
  | { type: "PROPERTY_COMPARISON"; data: { properties: unknown[] } }
  | { type: "MEDIA"; data: { media: unknown[]; location?: unknown } }
  | { type: "PAYMENT_PLANS"; data: { plans: unknown[] } }
  | { type: "SHARE_LINK"; data: { url: string } }
  | { type: "WHATSAPP_LINK"; data: { url: string } };

export function buildNadimUi(toolResults: NadimToolResult[], actions: ExecutedAction[]): NadimUiPayload[] {
  const ui: NadimUiPayload[] = [];
  for (const result of toolResults) {
    if (!result.ok) continue;
    if (result.tool === "PROPERTY_SEARCH" && Array.isArray(result.data) && result.data.length) {
      ui.push({ type: "PROPERTY_RESULTS", data: { properties: result.data } });
    } else if (result.tool === "COMPARE_PROPERTIES" && Array.isArray(result.data) && result.data.length) {
      ui.push({ type: "PROPERTY_COMPARISON", data: { properties: result.data } });
    } else if (result.tool === "GET_MEDIA" && result.data && !Array.isArray(result.data)) {
      const data = result.data as { media?: unknown[]; location?: unknown };
      ui.push({ type: "MEDIA", data: { media: Array.isArray(data.media) ? data.media : [], location: data.location } });
    } else if (result.tool === "GET_PAYMENT_PLAN" && Array.isArray(result.data)) {
      ui.push({ type: "PAYMENT_PLANS", data: { plans: result.data } });
    }
  }
  for (const action of actions) {
    if (action.status !== "SUCCEEDED" || !action.message) continue;
    if (action.type === "CREATE_CONVERSATION_SHARE_LINK") ui.push({ type: "SHARE_LINK", data: { url: action.message } });
    if (action.type === "CREATE_WHATSAPP_HANDOFF_LINK") ui.push({ type: "WHATSAPP_LINK", data: { url: action.message } });
  }
  return ui;
}
