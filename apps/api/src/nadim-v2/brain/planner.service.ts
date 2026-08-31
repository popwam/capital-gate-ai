import { Injectable } from "@nestjs/common";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NADIM_TOOLS, NadimPlan, NadimToolName } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";

@Injectable()
export class PlannerService {
  plan(understanding: NadimUnderstanding, state: NadimState): NadimPlan {
    if (state.pendingClarification) {
      return { goal: understanding.intent, steps: [], clarification: state.pendingClarification.reason };
    }
    if (understanding.ambiguity) {
      return { goal: understanding.intent, steps: [], clarification: understanding.ambiguity };
    }
    if (understanding.proposedToolCalls) {
      if (understanding.needsClarification || understanding.stateQueries?.length) {
        return { goal: understanding.responseGoal ?? "CLARIFY", steps: [], clarification: understanding.clarificationReason };
      }
      const steps = understanding.proposedToolCalls.flatMap((proposal) => {
        if (!(NADIM_TOOLS as readonly string[]).includes(proposal.tool)) return [];
        const tool = proposal.tool as NadimToolName;
        const arguments_ = { ...proposal.arguments };
        if (["GET_UNIT_FACTS", "GET_PAYMENT_PLAN", "GET_AVAILABILITY", "GET_MEDIA", "GET_LOCATION"].includes(tool)) {
          if (understanding.unitReference) {
            arguments_.unitReference = understanding.unitReference;
            delete arguments_.unitId;
          } else if (!arguments_.unitReference && !arguments_.unitId && state.selectedUnitId) {
            arguments_.unitId = state.selectedUnitId;
          }
        }
        if (tool === "COMPARE_PROPERTIES" && !arguments_.unitIds) arguments_.unitIds = state.comparisonUnitIds;
        if (tool === "PROPERTY_SEARCH") arguments_.limit = Math.min(10, Math.max(1, Number(arguments_.limit ?? 5)));
        return [{ tool, arguments: arguments_ }];
      }).slice(0, 4);
      return { goal: understanding.responseGoal ?? understanding.intent, steps };
    }
    const selectedUnitId = state.selectedUnitId;
    const unitArguments = understanding.unitReference
      ? { unitReference: understanding.unitReference }
      : selectedUnitId ? { unitId: selectedUnitId } : undefined;
    switch (understanding.intent) {
      case "PROPERTY_SEARCH":
      case "MODIFY_SEARCH":
        return { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: { constraints: state.search, limit: 5 } }] };
      case "RESET_SEARCH":
        return { goal: "RESET_SEARCH", steps: [] };
      case "CURRENT_SEARCH_QUERY":
      case "CORRECTION":
        return { goal: understanding.intent, steps: [] };
      case "COMPARISON":
        return state.comparisonUnitIds.length >= 2
          ? { goal: "COMPARISON", steps: [{ tool: "COMPARE_PROPERTIES", arguments: { unitIds: state.comparisonUnitIds } }] }
          : { goal: "COMPARISON", steps: [], clarification: "COMPARISON_SELECTION_REQUIRED" };
      case "PRICE_QUESTION":
      case "PROPERTY_QUESTION":
      case "LOCATION_QUESTION":
        return unitArguments
          ? { goal: understanding.intent, steps: [{ tool: "GET_UNIT_FACTS", arguments: unitArguments }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      case "PAYMENT_PLAN_QUESTION":
        return unitArguments
          ? { goal: understanding.intent, steps: [{ tool: "GET_PAYMENT_PLAN", arguments: unitArguments }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      case "AVAILABILITY_QUESTION":
        return unitArguments
          ? { goal: understanding.intent, steps: [{ tool: "GET_AVAILABILITY", arguments: unitArguments }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      case "MEDIA_REQUEST":
        return unitArguments
          ? { goal: understanding.intent, steps: [{ tool: "GET_MEDIA", arguments: unitArguments }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      default:
        return { goal: understanding.intent, steps: [] };
    }
  }
}
