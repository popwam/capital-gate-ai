import { Injectable, Optional } from "@nestjs/common";
import { AutomationActionClient } from "../actions/automation-action.client";
import { ExecutedAction, NADIM_ACTIONS, ProposedAction } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { NadimChannel } from "../dto/nadim-turn.dto";
import { CustomerLifecycleService } from "../product/customer-lifecycle.service";
import { resolveFollowUpDueAt, temporalRequestFromPayload } from "../product/follow-up-time";

@Injectable()
export class ActionPolicyService {
  constructor(private readonly actions: AutomationActionClient, @Optional() private readonly lifecycle?: CustomerLifecycleService) {}

  propose(understanding: NadimUnderstanding, state: NadimState): ProposedAction[] {
    if (understanding.proposedActions?.length && understanding.confidence >= 0.75) {
      return understanding.proposedActions.flatMap((proposal) => {
        if (!(NADIM_ACTIONS as readonly string[]).includes(proposal.type)) return [];
        const type = proposal.type as ProposedAction["type"];
        return [{ type, reason: proposal.reason, payload: { ...proposal.payload, ...(state.selectedUnitId ? { unitId: state.selectedUnitId } : {}) } }];
      });
    }
    // Compatibility fallback for the deterministic outage interpreter. The
    // action client and this policy still authorize execution, never the model.
    if (!understanding.actionRequested) return [];
    const unitId = state.selectedUnitId;
    const payload = unitId ? { unitId } : {};
    if (understanding.intent === "LEAD_REQUEST") return [{ type: "CREATE_LEAD", reason: "Customer explicitly requested contact", payload }];
    if (understanding.intent === "CALLBACK_REQUEST") return [{ type: "REQUEST_CALLBACK", reason: "Customer explicitly requested a callback", payload }];
    if (understanding.intent === "HUMAN_HANDOFF") return [{ type: "HUMAN_HANDOFF", reason: "Customer explicitly requested a human", payload }];
    if (understanding.intent === "VIEWING_REQUEST") return [{ type: "CREATE_VIEWING_REQUEST", reason: "Customer explicitly requested a viewing", payload }];
    if (understanding.intent === "RESERVATION_REQUEST") return [{ type: "CREATE_RESERVATION_REQUEST", reason: "Customer explicitly requested a reservation", payload }];
    return [];
  }

  async execute(proposals: ProposedAction[], context: { channel: NadimChannel; customerId?: string; externalUserId?: string; conversationId: string; requestId: string; state?: NadimState }): Promise<ExecutedAction[]> {
    const results: ExecutedAction[] = [];
    const executable = new Set<ProposedAction["type"]>(["CREATE_LEAD", "REQUEST_CALLBACK", "CREATE_VIEWING_REQUEST", "CREATE_RESERVATION_REQUEST"]);
    for (const proposal of proposals) {
      const productAction = await this.executeProductAction(proposal, context);
      if (productAction) { results.push(productAction); continue; }
      if (!executable.has(proposal.type)) {
        results.push({ type: proposal.type, status: "NOT_EXECUTED", errorCode: "ACTION_NOT_SUPPORTED" });
        continue;
      }
      if (["CREATE_VIEWING_REQUEST", "CREATE_RESERVATION_REQUEST"].includes(proposal.type) && !proposal.payload.unitId) {
        results.push({ type: proposal.type, status: "NOT_EXECUTED", errorCode: "UNIT_SELECTION_REQUIRED" });
        continue;
      }
      results.push(await this.actions.execute(proposal, context));
    }
    return results;
  }

  private async executeProductAction(proposal: ProposedAction, context: { channel: NadimChannel; externalUserId?: string; conversationId: string; state?: NadimState }): Promise<ExecutedAction | undefined> {
    if (!["SAVE_PROPERTY_REQUIREMENT", "CREATE_FOLLOWUP", "CREATE_CONVERSATION_SHARE_LINK", "CREATE_WHATSAPP_HANDOFF_LINK", "REVOKE_SHARE_LINK"].includes(proposal.type)) return undefined;
    if (!this.lifecycle) return { type: proposal.type, status: "FAILED", errorCode: "PRODUCT_LAYER_UNAVAILABLE" };
    if (!context.state && ["SAVE_PROPERTY_REQUIREMENT", "CREATE_FOLLOWUP"].includes(proposal.type)) return { type: proposal.type, status: "FAILED", errorCode: "PRODUCT_ACTION_CONTEXT_REQUIRED" };
    try {
      if (proposal.type === "SAVE_PROPERTY_REQUIREMENT") {
        const requirement = await this.lifecycle.saveRequirement({ conversationId: context.conversationId, channel: context.channel, externalUserId: context.externalUserId, state: context.state!, title: typeof proposal.payload.title === "string" ? proposal.payload.title : undefined, allowNew: proposal.payload.createNew === true });
        return { type: proposal.type, status: "SUCCEEDED", entityId: requirement.id };
      }
      if (proposal.type === "CREATE_FOLLOWUP") {
        const temporal = temporalRequestFromPayload(proposal.payload);
        if (!temporal) return { type: proposal.type, status: "NOT_EXECUTED", errorCode: "FOLLOWUP_TIME_REQUIRED" };
        const timezone = await this.lifecycle.conversationTimezone(context.conversationId) ?? this.localeTimezone(context.state!.locale);
        if (!timezone) return { type: proposal.type, status: "NOT_EXECUTED", errorCode: "TIMEZONE_REQUIRED" };
        const dueAt = resolveFollowUpDueAt(temporal, timezone);
        const task = await this.lifecycle.createFollowUp({
          conversationId: context.conversationId, channel: context.channel, externalUserId: context.externalUserId,
          dueAt, timezone, reason: proposal.reason, messageIntent: proposal.payload,
          renderedMessage: typeof proposal.payload.text === "string" ? proposal.payload.text : undefined,
          propertyRequirementId: typeof proposal.payload.propertyRequirementId === "string" ? proposal.payload.propertyRequirementId : undefined,
          dedupeSource: JSON.stringify(temporal),
        });
        return { type: proposal.type, status: "SUCCEEDED", entityId: task.id };
      }
      if (proposal.type === "CREATE_CONVERSATION_SHARE_LINK") {
        const created = await this.lifecycle.createToken({ conversationId: context.conversationId, type: "WEB_SHARE" });
        const base = process.env.WEB_BASE_URL?.trim()?.replace(/\/$/u, "");
        if (!base) { await this.lifecycle.revokeToken(created.id, context.conversationId); return { type: proposal.type, status: "FAILED", errorCode: "WEB_BASE_URL_REQUIRED" }; }
        return { type: proposal.type, status: "SUCCEEDED", entityId: created.id, message: `${base}/c/${encodeURIComponent(created.token)}` };
      }
      if (proposal.type === "CREATE_WHATSAPP_HANDOFF_LINK") {
        const number = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/gu, "");
        if (!number) return { type: proposal.type, status: "FAILED", errorCode: "WHATSAPP_BUSINESS_NUMBER_REQUIRED" };
        const created = await this.lifecycle.createToken({ conversationId: context.conversationId, type: "WHATSAPP_HANDOFF", maxUses: 1 });
        const text = encodeURIComponent(`continue ${created.token}`);
        return { type: proposal.type, status: "SUCCEEDED", entityId: created.id, message: `https://wa.me/${number}?text=${text}` };
      }
      if (proposal.type === "REVOKE_SHARE_LINK" && typeof proposal.payload.tokenId === "string") {
        await this.lifecycle.revokeToken(proposal.payload.tokenId, context.conversationId);
        return { type: proposal.type, status: "SUCCEEDED", entityId: proposal.payload.tokenId };
      }
      return { type: proposal.type, status: "NOT_EXECUTED", errorCode: "ACTION_INPUT_REQUIRED" };
    } catch (error) {
      return { type: proposal.type, status: "FAILED", errorCode: typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "PRODUCT_ACTION_FAILED" };
    }
  }

  private localeTimezone(locale: string) {
    const region = locale.match(/[-_]([A-Za-z]{2})\b/u)?.[1]?.toUpperCase();
    return ({ EG: "Africa/Cairo", SA: "Asia/Riyadh", AE: "Asia/Dubai", KW: "Asia/Kuwait", QA: "Asia/Qatar", BH: "Asia/Bahrain", OM: "Asia/Muscat" } as Record<string, string>)[region ?? ""];
  }
}
