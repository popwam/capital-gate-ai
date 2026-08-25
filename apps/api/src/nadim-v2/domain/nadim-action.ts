export const NADIM_ACTIONS = [
  "CREATE_LEAD", "UPDATE_LEAD", "ADD_NOTE", "RECORD_INTEREST", "CREATE_FOLLOWUP",
  "REQUEST_CALLBACK", "SEND_WHATSAPP", "START_OUTBOUND_CALL", "HUMAN_HANDOFF",
  "CHANGE_DEAL_STAGE", "CREATE_VIEWING_REQUEST", "CREATE_RESERVATION_REQUEST",
] as const;
export type NadimActionType = (typeof NADIM_ACTIONS)[number];
export type ProposedAction = { type: NadimActionType; reason: string; payload: Record<string, unknown> };
export type ExecutedAction = {
  type: NadimActionType;
  status: "SUCCEEDED" | "FAILED" | "NOT_EXECUTED";
  entityId?: string;
  errorCode?: string;
  message?: string;
};
