import type { ExecutedAction, ProposedAction } from "./nadim-action";
import type { NadimState } from "./nadim-state";

export type NadimTurnResult = {
  ok: true;
  version: "v2";
  replayed: boolean;
  conversationId: string;
  reply: string;
  intent: {
    type: string;
    confidence: number;
  };
  state: NadimState;
  results: unknown[];
  proposedActions: ProposedAction[];
  executedActions: ExecutedAction[];
  metadata: {
    requestId?: string;
    brainVersion: "v2";
    modelProvider?: string;
    model?: string;
    fallbackUsed: boolean;
    understandingModelProvider?: string;
    understandingModel?: string;
    understandingFallbackUsed: boolean;
    classificationSource?: string;
    understoodMeaning?: string;
    responseGoal?: string;
    unknownReason?: string;
    recentContextUsed: boolean;
    toolDecision: "EXECUTE" | "CLARIFY" | "NO_TOOL";
    toolNames: string[];
    latencyMs: number;
  };
};
