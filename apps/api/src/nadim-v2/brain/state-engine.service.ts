import { Injectable } from "@nestjs/common";
import { NadimUnderstanding, StateOperation } from "../domain/nadim-intent";
import { initialNadimState, NadimSearchState, NadimState } from "../domain/nadim-state";

const ARRAY_FIELDS = new Set(["locations", "projects", "developers", "propertyTypes"]);
const NUMBER_FIELDS = new Set(["bedrooms", "bathrooms", "areaMin", "areaMax", "budgetMin", "budgetMax", "downPaymentMax", "installmentMonths", "deliveryMaxYears"]);

@Injectable()
export class StateEngineService {
  apply(previous: NadimState, understanding: NadimUnderstanding, identity: { channel: NadimState["channel"]; customerId?: string; externalUserId?: string; locale?: string }) {
    let state = structuredClone(previous);
    const operations = ["GREETING", "CURRENT_SEARCH_QUERY", "SMALL_TALK", "UNKNOWN"].includes(understanding.intent)
      ? understanding.operations.filter((operation) => operation.operation === "PRESERVE")
      : understanding.operations;
    for (const operation of operations) state = this.applyOperation(state, operation);
    state.channel = identity.channel;
    state.customerId = identity.customerId ?? state.customerId;
    state.externalUserId = identity.externalUserId ?? state.externalUserId;
    state.locale = identity.locale ?? understanding.locale ?? state.locale;
    state.goal = understanding.intent;
    state.lastOperations = operations;
    state.pendingClarification = undefined;

    if (understanding.ordinalReferences.length) {
      const resolved = understanding.ordinalReferences.map((ordinal) => state.lastResultIds[ordinal - 1]).filter(Boolean);
      if (resolved.length !== understanding.ordinalReferences.length) {
        state.pendingClarification = { reason: "RESULT_REFERENCE_NOT_FOUND" };
      } else if (understanding.intent === "COMPARISON") {
        state.comparisonUnitIds = [...new Set(resolved)];
      } else {
        state.selectedUnitId = resolved[resolved.length - 1];
      }
    }
    state.revision += 1;
    return state;
  }

  withResults(state: NadimState, resultIds: string[]) {
    return { ...state, lastResultIds: resultIds.slice(0, 20) };
  }

  withAssistantWording(state: NadimState, reply: string) {
    return { ...state, recentAssistantWording: reply.trim().slice(0, 1_000) };
  }

  fresh(identity: Parameters<typeof initialNadimState>[0]) {
    return initialNadimState(identity);
  }

  private applyOperation(state: NadimState, operation: StateOperation): NadimState {
    if (operation.operation === "PRESERVE") return state;
    if (operation.operation === "RESET" && (!operation.field || operation.field === "SEARCH")) {
      return {
        ...state,
        search: initialNadimState({ channel: state.channel, locale: state.locale }).search,
        selectedUnitId: undefined,
        selectedProjectId: undefined,
        comparisonUnitIds: [],
        lastResultIds: [],
      };
    }
    if (!operation.field || operation.field === "SEARCH") return state;
    const field = operation.field as keyof NadimSearchState;
    const search = { ...state.search };
    if (operation.operation === "REMOVE" || operation.operation === "RESET") {
      if (ARRAY_FIELDS.has(field)) (search[field] as string[]) = [];
      else delete search[field];
      return { ...state, search };
    }
    if (operation.operation !== "SET") return state;
    if (ARRAY_FIELDS.has(field)) {
      if (!Array.isArray(operation.value)) return state;
      const values = operation.value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 10);
      (search[field] as string[]) = [...new Set(values)];
    } else if (NUMBER_FIELDS.has(field)) {
      if (typeof operation.value !== "number" || !Number.isFinite(operation.value) || operation.value < 0) return state;
      (search as Record<string, unknown>)[field] = operation.value;
    } else if (field === "purpose" && ["LIVING", "INVESTMENT"].includes(String(operation.value))) {
      search.purpose = operation.value as NadimSearchState["purpose"];
    } else if (field === "queryObjective" && ["BEST_MATCH", "CHEAPEST", "MOST_EXPENSIVE"].includes(String(operation.value))) {
      search.queryObjective = operation.value as NadimSearchState["queryObjective"];
    } else if (field === "installmentPreference" && ["INSTALLMENTS", "LONG_TERM"].includes(String(operation.value))) {
      search.installmentPreference = operation.value as NadimSearchState["installmentPreference"];
    } else if (["currency", "finishing"].includes(field) && typeof operation.value === "string" && operation.value.trim()) {
      (search as Record<string, unknown>)[field] = operation.value.trim().slice(0, 80);
    }
    return { ...state, search };
  }
}
