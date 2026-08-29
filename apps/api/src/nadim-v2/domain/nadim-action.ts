export const NADIM_ACTIONS = [
  "CREATE_LEAD", "UPDATE_LEAD", "ADD_NOTE", "RECORD_INTEREST", "CREATE_FOLLOWUP",
  "REQUEST_CALLBACK", "SEND_WHATSAPP", "START_OUTBOUND_CALL", "HUMAN_HANDOFF",
  "CHANGE_DEAL_STAGE", "CREATE_VIEWING_REQUEST", "CREATE_RESERVATION_REQUEST",
  "SAVE_CUSTOMER_INFO", "SAVE_PROPERTY_REQUIREMENT", "CREATE_CONVERSATION_SHARE_LINK",
  "CREATE_WHATSAPP_HANDOFF_LINK", "REVOKE_SHARE_LINK",
] as const;
export type NadimActionType = (typeof NADIM_ACTIONS)[number];
export type ProposedAction = { type: NadimActionType; reason: string; payload: Record<string, unknown> };
export type ExecutedAction = {
  type: NadimActionType | NadimControlAction;
  status: "SUCCEEDED" | "FAILED" | "NOT_EXECUTED";
  entityId?: string;
  errorCode?: string;
  message?: string;
};

export const NADIM_CONTROL_ACTIONS = [
  "HUMAN_HANDOFF", "RETURN_TO_AI", "REQUEST_CONVERSATION_DELETION", "CONFIRM_CONVERSATION_DELETION",
] as const;
export type NadimControlAction = (typeof NADIM_CONTROL_ACTIONS)[number];
export type NadimConversationMode = "AI" | "HUMAN" | "PAUSED";
