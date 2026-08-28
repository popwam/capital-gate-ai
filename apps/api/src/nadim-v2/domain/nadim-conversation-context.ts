import type { CurrentSearchQueryTarget, NadimIntentType } from "./nadim-intent";
import type { NadimState } from "./nadim-state";
import type { NadimConversationMode } from "./nadim-action";

export type NadimConversationStage = "DISCOVERY" | "ACTIVE_SEARCH" | "RESULTS_AVAILABLE" | "RESULT_SELECTED";

export type NadimRecentToolSummary = {
  tool: string;
  ok: boolean;
  resultCount?: number;
  errorCode?: string;
};

export type NadimRecentTurnContext = {
  user: string;
  assistant: string;
  intent?: NadimIntentType;
  stateQuery?: CurrentSearchQueryTarget;
  responseGoal?: string;
  tools: NadimRecentToolSummary[];
};

export type NadimConversationContext = {
  mode?: NadimConversationMode;
  stage: NadimConversationStage;
  recentTurns: NadimRecentTurnContext[];
  lastVerifiedToolSummary?: NadimRecentToolSummary[];
  summary?: Record<string, unknown>;
  customerContext?: Record<string, unknown>;
  pendingDeletion?: { requestedAt: string; expiresAt: string };
};

export function conversationStage(state: NadimState): NadimConversationStage {
  if (state.selectedUnitId || state.selectedProjectId) return "RESULT_SELECTED";
  if (state.lastResultIds.length > 0) return "RESULTS_AVAILABLE";
  const search = state.search;
  const hasSearch = search.locations.length > 0
    || search.projects.length > 0
    || search.developers.length > 0
    || search.propertyTypes.length > 0
    || Object.entries(search).some(([field, value]) => !["locations", "projects", "developers", "propertyTypes"].includes(field) && value !== undefined);
  return hasSearch ? "ACTIVE_SEARCH" : "DISCOVERY";
}
