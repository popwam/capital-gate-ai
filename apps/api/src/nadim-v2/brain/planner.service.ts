import { Injectable } from "@nestjs/common";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";

@Injectable()
export class PlannerService {
  plan(understanding: NadimUnderstanding, state: NadimState): NadimPlan {
    if (state.pendingClarification) {
      return { goal: understanding.intent, steps: [], clarification: "RESULT_REFERENCE_NOT_FOUND" };
    }
    const selectedUnitId = state.selectedUnitId;
    const unitArguments = selectedUnitId ? { unitId: selectedUnitId } : understanding.unitReference ? { unitReference: understanding.unitReference } : undefined;
    switch (understanding.intent) {
      case "PROPERTY_SEARCH":
      case "MODIFY_SEARCH":
        return { goal: "PROPERTY_SEARCH", steps: [{ tool: "PROPERTY_SEARCH", arguments: { constraints: state.search, limit: 5 } }] };
      case "RESET_SEARCH":
        return { goal: "RESET_SEARCH", steps: [] };
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
        return selectedUnitId
          ? { goal: understanding.intent, steps: [{ tool: "GET_PAYMENT_PLAN", arguments: { unitId: selectedUnitId } }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      case "AVAILABILITY_QUESTION":
        return selectedUnitId
          ? { goal: understanding.intent, steps: [{ tool: "GET_AVAILABILITY", arguments: { unitId: selectedUnitId } }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      case "MEDIA_REQUEST":
        return selectedUnitId
          ? { goal: understanding.intent, steps: [{ tool: "GET_MEDIA", arguments: { unitId: selectedUnitId } }] }
          : { goal: understanding.intent, steps: [], clarification: "UNIT_SELECTION_REQUIRED" };
      default:
        return { goal: understanding.intent, steps: [] };
    }
  }
}
