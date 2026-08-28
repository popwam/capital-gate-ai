import { Injectable } from "@nestjs/common";
import { AutomationActionClient } from "../actions/automation-action.client";
import { ExecutedAction, NADIM_ACTIONS, ProposedAction } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { NadimChannel } from "../dto/nadim-turn.dto";

@Injectable()
export class ActionPolicyService {
  constructor(private readonly actions: AutomationActionClient) {}

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

  async execute(proposals: ProposedAction[], context: { channel: NadimChannel; customerId?: string; externalUserId?: string; conversationId: string; requestId: string }): Promise<ExecutedAction[]> {
    const results: ExecutedAction[] = [];
    const executable = new Set<ProposedAction["type"]>(["CREATE_LEAD", "REQUEST_CALLBACK", "CREATE_VIEWING_REQUEST", "CREATE_RESERVATION_REQUEST"]);
    for (const proposal of proposals) {
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
}
