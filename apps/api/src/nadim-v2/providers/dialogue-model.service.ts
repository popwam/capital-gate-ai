import { Injectable, Optional } from "@nestjs/common";
import { AIUsageService } from "../../providers/ai-usage.service";
import { NADIM_ACTIONS, NADIM_CONTROL_ACTIONS } from "../domain/nadim-action";
import { NadimBrainDecisionSchema } from "../domain/nadim-brain-decision";
import { NadimConversationContext, conversationStage } from "../domain/nadim-conversation-context";
import { NADIM_INTENTS, NadimSemanticInterpretationSchema } from "../domain/nadim-intent";
import { NADIM_TOOLS } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { NADIM_PERSONALITY_PROMPT } from "../personality/nadim-personality";
import { BedrockGlmProvider } from "./bedrock-glm.provider";
import {
  DialogueMessage,
  DialogueProvider,
  DialogueProviderAttempt,
  DialogueProviderChainError,
  DialogueProviderError,
  DialogueStreamInterruptedError,
} from "./dialogue-provider";
import { GroqDialogueProvider } from "./groq-dialogue.provider";

export type DialogueResult<T> = {
  value: T;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  fallbackStage: "NONE" | "SECONDARY_PROVIDER";
  latencyMs: number;
  attempts: DialogueProviderAttempt[];
};

type Trace = { conversationId?: string; requestId?: string };

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
}

function compactState(state: NadimState, context?: NadimConversationContext) {
  return {
    channel: state.channel,
    locale: state.locale,
    ownershipMode: context?.mode ?? "AI",
    stage: context?.stage ?? conversationStage(state),
    activeSearch: state.search,
    selectedUnitId: state.selectedUnitId,
    selectedProjectId: state.selectedProjectId,
    recentResultIds: state.lastResultIds.slice(0, 10),
    pendingClarification: state.pendingClarification,
    pendingDeletion: context?.pendingDeletion,
    responseLanguage: state.languageStyle.preferredResponseStyle,
    regionalVariant: state.languageStyle.regionalVariant,
    grammaticalAddress: state.languageStyle.grammaticalAddress,
    lastSuccessfulStateOperations: state.lastOperations,
    recentAssistantWording: state.recentAssistantWording?.slice(0, 1_000),
    conversationSummary: context?.summary,
    customerContext: context?.customerContext,
  };
}

const decisionInstructions = [
  "You are the primary conversation brain for Nadim, an AI real-estate customer-service agent. Interpret ordinary human language before considering labels.",
  "Return one JSON object matching this contract: understood, understoodMeaning, conversationalGoal, responsePlan, conversationalType, intent, references, proposedStateOperations, proposedToolCalls, proposedActions, customerContextUpdates, stateQueries, responseStyleRequest, needsClarification, clarificationReason, locale, recentContextUsed, confidence.",
  "intent is optional execution and analytics metadata, never the center of the dialogue. A meaningful response may need no intent, state operation, tool, or action.",
  `When useful, intent is one of ${NADIM_INTENTS.join(", ")}. conversationalType is CONVERSATION, DISCOVERY, REACTION, ACKNOWLEDGEMENT, STRUCTURED_REQUEST, or CLARIFICATION.`,
  "Resolve pronouns, ordinals, ellipsis, corrections, noisy spelling, and references from recent dialogue, selected result, recent verified results, active search, customer context, then summary. Clarify only when competing meanings remain genuinely plausible.",
  "Customer background belongs in customerContextUpdates and is not an active search constraint until the customer expresses it as a preference.",
  "State operations are proposals only: SET, REMOVE, RESET, PRESERVE. Do not invent a constraint or claim an operation succeeded.",
  `Tool calls are proposals only and must use ${NADIM_TOOLS.join(", ")}. Inventory is a tool, not the conversation. Do not request it for greetings, memory, identity, small talk, discovery, language, handoff, deletion, or acknowledgements.`,
  `Actions are proposals only and must use ${[...NADIM_ACTIONS, ...NADIM_CONTROL_ACTIONS].join(", ")}. Requesting deletion first proposes REQUEST_CONVERSATION_DELETION; only an explicit confirmation while pending proposes CONFIRM_CONVERSATION_DELETION.`,
  "A human handoff request proposes HUMAN_HANDOFF. A clear request to resume Nadim while ownershipMode is HUMAN proposes RETURN_TO_AI. Never assume either action succeeded.",
  "Use SAVE_PROPERTY_REQUIREMENT when the customer asks to retain a distinct property brief, CREATE_FOLLOWUP only with an explicit future dueAt and IANA timezone, CREATE_CONVERSATION_SHARE_LINK for a secure web conversation link, and CREATE_WHATSAPP_HANDOFF_LINK to continue the same web conversation on WhatsApp. These are deterministic actions; never claim success before execution.",
  "For time questions, propose GET_CURRENT_TIME. Never guess the current time or timezone.",
  "Input language does not change sticky response language. Set responseStyleRequest only when the customer explicitly asks for a supported response language or dialect; otherwise use null.",
  "Nadim is an AI assistant and must be honest about that. Never invent inventory, prices, availability, payment facts, customer identity, action success, or internal IDs.",
  "Set understood=false only when the message genuinely has no recoverable conversational meaning.",
].join(" ");

@Injectable()
export class DialogueModelService {
  constructor(
    private readonly glm: BedrockGlmProvider,
    private readonly groq: GroqDialogueProvider,
    @Optional() private readonly usage?: AIUsageService,
  ) {}

  private providers() {
    return [this.glm, this.groq].filter((provider, index, values) =>
      provider.enabled() && provider.configured()
      && values.findIndex((item) => item.provider === provider.provider) === index);
  }

  available() {
    return this.providers().length > 0;
  }

  decide(message: string, state: NadimState, context?: NadimConversationContext, trace: Trace = {}) {
    const messages: DialogueMessage[] = [
      { role: "system", content: decisionInstructions },
      { role: "user", content: JSON.stringify({
        latestMessage: message,
        recentDialogue: context?.recentTurns ?? [],
        persistedContext: compactState(state, context),
        lastVerifiedToolResultSummary: context?.lastVerifiedToolSummary,
        availableTools: NADIM_TOOLS,
        availableActions: [...NADIM_ACTIONS, ...NADIM_CONTROL_ACTIONS],
      }) },
    ];
    return this.call("NADIM_V2_BRAIN_DECISION", messages, true, (text) =>
      NadimBrainDecisionSchema.parse(JSON.parse(stripFence(text))), trace);
  }

  continueAfterTools(input: Record<string, unknown>, trace: Trace = {}) {
    const messages: DialogueMessage[] = [
      { role: "system", content: `${decisionInstructions} This is a bounded continuation after verified tool output. Do not repeat a completed tool call. Propose another tool only when the verified result makes it necessary; otherwise make proposedToolCalls empty and update the response plan.` },
      { role: "user", content: JSON.stringify(input) },
    ];
    return this.call("NADIM_V2_TOOL_CONTINUATION", messages, true, (text) =>
      NadimBrainDecisionSchema.parse(JSON.parse(stripFence(text))), trace);
  }

  // Rollback/admin compatibility only. Public V2 turns use decide().
  understand(message: string, state: NadimState, context?: NadimConversationContext, trace: Trace = {}) {
    const messages: DialogueMessage[] = [
      { role: "system", content: `Semantically interpret the message for Nadim. Ordinary meaningful conversation does not need a dedicated intent. Return the existing Nadim semantic JSON contract. proposedIntent may be one of ${NADIM_INTENTS.join(", ")}.` },
      { role: "user", content: JSON.stringify({ latestMessage: message, recentDialogue: context?.recentTurns ?? [], persistedContext: compactState(state, context) }) },
    ];
    return this.call("NADIM_V2_UNDERSTAND_COMPAT", messages, true, (text) =>
      NadimSemanticInterpretationSchema.parse(JSON.parse(stripFence(text))), trace);
  }

  compose(input: Record<string, unknown>, trace: Trace = {}): Promise<DialogueResult<string>> {
    const messages: DialogueMessage[] = [
      {
        role: "system",
        content: `${NADIM_PERSONALITY_PROMPT} Follow responsePlan and responseGoal as one natural customer-service reply. Use the sticky styleProfile. Treat deterministic state, verified facts, tool outcomes, control outcomes, and action results as read-only truth. Never invent a fact or successful action. Do not claim no inventory unless a successful PROPERTY_SEARCH returned an empty list. Say honestly that Nadim is an AI assistant when asked.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ];
    return this.call("NADIM_V2_COMPOSE", messages, false, (text) => text.trim(), trace);
  }

  async *composeStream(input: Record<string, unknown>): AsyncIterable<{ chunk: string; provider: string; model: string; fallbackUsed: boolean }> {
    const messages: DialogueMessage[] = [
      { role: "system", content: `${NADIM_PERSONALITY_PROMPT} Compose using only supplied verified facts. Never alter facts or claim an unconfirmed action.` },
      { role: "user", content: JSON.stringify(input) },
    ];
    const providers = this.providers();
    let lastError: unknown;
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      let emitted = false;
      try {
        for await (const chunk of provider.stream(messages)) {
          if (!chunk) continue;
          emitted = true;
          yield { chunk, provider: provider.provider, model: provider.model, fallbackUsed: index > 0 };
        }
        return;
      } catch (error) {
        if (emitted) throw new DialogueStreamInterruptedError(provider.provider);
        lastError = error;
      }
    }
    throw lastError ?? new DialogueProviderError("none", "NOT_CONFIGURED", false);
  }

  async health() {
    const results = await Promise.all([this.glm.health(), this.groq.health()]);
    return results.map((result) => ({ ...result, priority: result.provider === this.glm.provider ? "PRIMARY" as const : "SECONDARY" as const }));
  }

  private async call<T>(taskType: string, messages: DialogueMessage[], jsonMode: boolean, map: (text: string) => T, trace: Trace): Promise<DialogueResult<T>> {
    const providers = this.providers();
    const attempts: DialogueProviderAttempt[] = [];
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      const started = Date.now();
      try {
        const value = map(await provider.complete(messages, jsonMode));
        const latencyMs = Date.now() - started;
        void this.recordUsage(provider, taskType, latencyMs, true, index > 0, undefined, trace);
        return { value, provider: provider.provider, model: provider.model, fallbackUsed: index > 0, fallbackStage: index > 0 ? "SECONDARY_PROVIDER" : "NONE", latencyMs, attempts };
      } catch (error) {
        const latencyMs = Date.now() - started;
        const errorCategory = error instanceof DialogueProviderError ? error.code : "INVALID_OUTPUT";
        attempts.push({ provider: provider.provider, model: provider.model, latencyMs, errorCategory });
        void this.recordUsage(provider, taskType, latencyMs, false, index > 0, errorCategory, trace);
      }
    }
    if (!providers.length) attempts.push({ provider: "none", model: "none", latencyMs: 0, errorCategory: "NOT_CONFIGURED" });
    throw new DialogueProviderChainError(attempts);
  }

  private recordUsage(provider: DialogueProvider, taskType: string, latencyMs: number, success: boolean, fallbackUsed: boolean, errorCode: string | undefined, trace: Trace) {
    return this.usage?.record({ provider: provider.provider, model: provider.model, taskType, latencyMs, success, fallbackUsed, errorCode, promptVersion: "nadim-v2.2-ai-brain", conversationId: trace.conversationId });
  }
}
