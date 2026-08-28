import { Injectable } from "@nestjs/common";
import { ExecutedAction, NadimControlAction, NadimConversationMode } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimControlCommand } from "../dto/nadim-turn.dto";
import { NadimConversationService } from "../persistence/nadim-conversation.service";

export type ControlDecision = {
  action?: NadimControlAction;
  executed?: ExecutedAction;
  mode: NadimConversationMode;
  suppressReply: boolean;
  deleteConfirmed: boolean;
};

@Injectable()
export class ConversationControlService {
  constructor(private readonly conversations: NadimConversationService) {}

  async apply(input: {
    conversationId: string;
    mode: NadimConversationMode;
    command?: NadimControlCommand;
    understanding?: NadimUnderstanding;
    pendingDeletion?: { expiresAt?: string };
    hasIdempotencyKey: boolean;
  }): Promise<ControlDecision> {
    const action = this.requestedAction(input.command, input.understanding);

    if (input.mode === "HUMAN") {
      if (action !== "RETURN_TO_AI") return { mode: "HUMAN", suppressReply: true, deleteConfirmed: false };
      await this.conversations.setMode(input.conversationId, "AI");
      return {
        action,
        executed: { type: action, status: "SUCCEEDED" },
        mode: "AI",
        suppressReply: false,
        deleteConfirmed: false,
      };
    }

    if (!action) return { mode: input.mode, suppressReply: false, deleteConfirmed: false };
    if (action === "HUMAN_HANDOFF") {
      await this.conversations.setMode(input.conversationId, "HUMAN");
      return { action, executed: { type: action, status: "SUCCEEDED" }, mode: "HUMAN", suppressReply: false, deleteConfirmed: false };
    }
    if (action === "RETURN_TO_AI") {
      return { action, executed: { type: action, status: "NOT_EXECUTED", errorCode: "CONVERSATION_ALREADY_AI" }, mode: "AI", suppressReply: false, deleteConfirmed: false };
    }
    if (action === "REQUEST_CONVERSATION_DELETION") {
      await this.conversations.requestDeletion(input.conversationId);
      return { action, executed: { type: action, status: "SUCCEEDED" }, mode: input.mode, suppressReply: false, deleteConfirmed: false };
    }
    const pendingIsActive = input.pendingDeletion?.expiresAt
      ? Date.parse(input.pendingDeletion.expiresAt) > Date.now()
      : false;
    if (!pendingIsActive) {
      return { action, executed: { type: action, status: "NOT_EXECUTED", errorCode: "DELETION_CONFIRMATION_NOT_PENDING" }, mode: input.mode, suppressReply: false, deleteConfirmed: false };
    }
    if (!input.hasIdempotencyKey) {
      return { action, executed: { type: action, status: "NOT_EXECUTED", errorCode: "IDEMPOTENCY_KEY_REQUIRED" }, mode: input.mode, suppressReply: false, deleteConfirmed: false };
    }
    return { action, executed: { type: action, status: "SUCCEEDED" }, mode: input.mode, suppressReply: false, deleteConfirmed: true };
  }

  private requestedAction(command: NadimControlCommand | undefined, understanding?: NadimUnderstanding): NadimControlAction | undefined {
    if (command === "REQUEST_HUMAN_HANDOFF") return "HUMAN_HANDOFF";
    if (command) return command;
    const allowed = new Set<NadimControlAction>(["HUMAN_HANDOFF", "RETURN_TO_AI", "REQUEST_CONVERSATION_DELETION", "CONFIRM_CONVERSATION_DELETION"]);
    const proposed = understanding?.proposedActions?.find((item) => allowed.has(item.type as NadimControlAction));
    return proposed?.type as NadimControlAction | undefined;
  }
}
