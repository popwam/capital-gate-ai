import { Injectable } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { NadimChannel } from "../dto/nadim-turn.dto";

type ActionContext = {
  channel: NadimChannel;
  customerId?: string;
  externalUserId?: string;
  conversationId: string;
  requestId: string;
};

@Injectable()
export class AutomationActionClient {
  async execute(action: ProposedAction, context: ActionContext): Promise<ExecutedAction> {
    if (process.env.NADIM_ACTION_EXECUTION_ENABLED !== "true") return { type: action.type, status: "NOT_EXECUTED", errorCode: "ACTION_EXECUTION_DISABLED" };
    const baseUrl = process.env.NADIM_AUTOMATION_API_URL?.trim();
    const secret = process.env.NADIM_AUTOMATION_SECRET?.trim();
    if (!baseUrl || !secret) return { type: action.type, status: "FAILED", errorCode: "ACTION_LAYER_NOT_CONFIGURED" };
    if (action.type === "HUMAN_HANDOFF") return { type: action.type, status: "NOT_EXECUTED", errorCode: "ACTION_NOT_SUPPORTED" };
    const channel = context.channel === "N8N" ? undefined : context.channel;
    if (!channel) return { type: action.type, status: "NOT_EXECUTED", errorCode: "CUSTOMER_CHANNEL_REQUIRED" };
    const intent = action.type === "CREATE_VIEWING_REQUEST" ? "VIEWING" : action.type === "CREATE_RESERVATION_REQUEST" ? "RESERVATION" : "INQUIRY";
    const body = {
      idempotencyKey: `${context.requestId}:${action.type}`,
      source: context.channel === "WEB" ? "WEB_CHAT" : context.channel,
      channel,
      customerId: context.customerId,
      customer: context.externalUserId || action.payload.fullName || action.payload.phone ? {
        channelExternalId: context.externalUserId,
        name: typeof action.payload.fullName === "string" ? action.payload.fullName : undefined,
        phone: typeof action.payload.phone === "string" ? action.payload.phone : undefined,
      } : undefined,
      lead: {
        intent,
        intentScore: action.type === "CREATE_RESERVATION_REQUEST" ? 95 : action.type === "CREATE_VIEWING_REQUEST" ? 90 : 75,
        notes: String(action.payload.note ?? action.reason).slice(0, 4_000),
        preferredContactChannel: typeof action.payload.preferredContactChannel === "string" ? action.payload.preferredContactChannel : undefined,
      },
      context: { externalChannelId: context.externalUserId, eventId: context.requestId, metadata: {
        nadimBrainVersion: "v2",
        nadimConversationId: context.conversationId,
        requestedAction: action.type,
        unitId: action.payload.unitId,
        paymentMethod: action.payload.paymentMethod,
        verifiedPaymentPlans: action.payload.verifiedPaymentPlans,
      } },
    };
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/u, "")}/v1/leads/upsert`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nadim-automation-secret": secret },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json().catch(() => ({})) as any;
      if (!response.ok || payload.ok !== true) return { type: action.type, status: "FAILED", errorCode: payload?.error?.code ?? `ACTION_HTTP_${response.status}` };
      return { type: action.type, status: "SUCCEEDED", entityId: payload.lead?.id ?? payload.customer?.id };
    } catch {
      return { type: action.type, status: "FAILED", errorCode: "ACTION_LAYER_UNAVAILABLE" };
    }
  }
}
