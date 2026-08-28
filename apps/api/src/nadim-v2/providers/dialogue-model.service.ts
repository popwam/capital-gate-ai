import { Injectable, Optional } from "@nestjs/common";
import { AIUsageService } from "../../providers/ai-usage.service";
import { NadimConversationContext, conversationStage } from "../domain/nadim-conversation-context";
import { NADIM_INTENTS } from "../domain/nadim-intent";
import { NadimState } from "../domain/nadim-state";
import { NADIM_PERSONALITY_PROMPT } from "../personality/nadim-personality";
import { BedrockGlmProvider } from "./bedrock-glm.provider";
import { DialogueMessage, DialogueProvider, DialogueProviderError, DialogueStreamInterruptedError } from "./dialogue-provider";
import { GroqDialogueProvider } from "./groq-dialogue.provider";

export type DialogueResult<T> = {
  value: T;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  latencyMs: number;
};

type Trace = { conversationId?: string; requestId?: string };

function stripFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
}

function compactState(state: NadimState, context?: NadimConversationContext) {
  return {
    channel: state.channel,
    locale: state.locale,
    stage: context?.stage ?? conversationStage(state),
    search: state.search,
    selectedUnitId: state.selectedUnitId,
    selectedProjectId: state.selectedProjectId,
    recentResultIds: state.lastResultIds.slice(0, 10),
    pendingClarification: state.pendingClarification,
    responseLanguage: state.languageStyle.preferredResponseStyle,
    regionalVariant: state.languageStyle.regionalVariant,
    grammaticalAddress: state.languageStyle.grammaticalAddress,
    lastSuccessfulStateOperations: state.lastOperations,
    recentAssistantWording: state.recentAssistantWording?.slice(0, 1_000),
  };
}

@Injectable()
export class DialogueModelService {
  constructor(
    private readonly glm: BedrockGlmProvider,
    private readonly groq: GroqDialogueProvider,
    @Optional() private readonly usage?: AIUsageService,
  ) {}

  private providers() {
    // Dialogue work is latency-sensitive and benefits from Groq's conversational
    // interpretation. GLM remains the configured fallback; neither provider is
    // allowed to execute tools or mutate state.
    return [this.groq, this.glm].filter((provider, index, values) => provider.enabled() && values.findIndex((item) => item.provider === provider.provider) === index);
  }

  available() {
    return this.providers().length > 0;
  }

  async understand(message: string, state: NadimState, context?: NadimConversationContext, trace: Trace = {}): Promise<DialogueResult<unknown>> {
    const messages: DialogueMessage[] = [
      {
        role: "system",
        content: [
          "You semantically interpret the latest message for Nadim, a real-estate customer-service assistant. Start with what the person means and what a helpful next response should accomplish; deterministic code remains the decision maker.",
          "Read the latest message as ordinary human language in the flow of recentDialogue and persistedContext. Resolve paraphrases, pronouns, reactions, incomplete thoughts, ordinals, and typos before treating it as unclear.",
          "Reference priority is: immediate dialogue, selected result, recent result list, active search state, then recent topic. If one meaning dominates, use it. Clarify only when two meanings remain genuinely plausible.",
          "Return one JSON object only with: understood, understoodMeaning, responseGoal, conversationalType, proposedIntent, proposedStateOperations, references, toolNeed, clarification, confidence, locale, stateQuery, ordinalReferences, unitReference, projectReference, and recentContextUsed.",
          "conversationalType is one of CONVERSATION, DISCOVERY, REACTION, ACKNOWLEDGEMENT, STRUCTURED_REQUEST, CLARIFICATION. confidence is 0..1 and ordinals are one-based. Use null for inapplicable optional scalar fields.",
          `proposedIntent is optional execution metadata and, when needed, must be one of: ${NADIM_INTENTS.join(", ")}. Ordinary meaningful conversation does not need a dedicated intent: use proposedIntent null and describe its meaning and response goal.`,
          "Set understood=false only for genuinely unintelligible or corrupted text, not merely because wording lacks a predefined intent. A conversational response may be useful with no facts, state operation, or tool.",
          "ASSISTANT_NATURE covers whether Nadim is human, a robot, or AI. Nadim is an AI assistant and must never be interpreted as claiming to be human. Conversation-memory questions use CURRENT_SEARCH_QUERY and deterministic stateQuery fields.",
          "A question about whether Nadim speaks a language is LANGUAGE_CAPABILITY_QUERY. Only a request to reply in a language is LANGUAGE_STYLE_CHANGE. Input language never changes the persisted response style by itself.",
          "Allowed proposedStateOperations are SET, REMOVE, RESET, PRESERVE. Extract only changes actually requested in this turn. Customer background or context is not a search constraint until the person expresses it as a preference. Never silently widen, invent, or directly apply state.",
          "Allowed state fields: locations, projects, developers, propertyTypes, bedrooms, bathrooms, areaMin, areaMax, budgetMin, budgetMax, currency, downPaymentMax, installmentMonths, installmentPreference, deliveryMaxYears, purpose, finishing, queryObjective, SEARCH. installmentPreference is INSTALLMENTS or LONG_TERM; never invent installmentMonths from vague wording such as long installments.",
          "For CURRENT_SEARCH_QUERY return no operations and set stateQuery to a state field, SEARCH, or SELECTED_RESULT; the answer comes from persistedContext. Conversation, discovery, reactions, identity/nature/capabilities, language turns, greetings, small talk, rejections, acknowledgements, and plain memory questions need no inventory tool.",
          "A broad desire to buy or rent without usable constraints is discovery, not an inventory search. Ask one useful next question. Reactions to an option do not mutate search state unless the latest message actually requests a change. A request to contact someone is action-shaped, but only deterministic policy may authorize execution.",
          "Never invent inventory, prices, availability, payment facts, actions, or customer identity. Do not expose internal IDs in understoodMeaning.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify({
          latestMessage: message,
          recentDialogue: context?.recentTurns ?? [],
          persistedContext: compactState(state, context),
          lastVerifiedToolResultSummary: context?.lastVerifiedToolSummary,
        }),
      },
    ];
    return this.call("NADIM_V2_UNDERSTAND", messages, true, (text) => JSON.parse(stripFence(text)), trace);
  }

  async compose(input: Record<string, unknown>, trace: Trace = {}): Promise<DialogueResult<string>> {
    const messages: DialogueMessage[] = [
      {
        role: "system",
        content: `${NADIM_PERSONALITY_PROMPT} Answer the current responseGoal as a concise real-estate customer-service conversation. Use recentDialogue to follow the flow and avoid repetition. Apply the supplied styleProfile exactly. Treat deterministicAnswer, verifiedFacts, current state, searchExecution, and actionResults as read-only. Never add a price, availability claim, inventory fact, state change, or successful action. If asked about your nature, say transparently that you are an AI assistant named Nadim and never claim to be human.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ];
    return this.call("NADIM_V2_COMPOSE", messages, false, (text) => text.trim(), trace);
  }

  async *composeStream(input: Record<string, unknown>): AsyncIterable<{ chunk: string; provider: string; model: string; fallbackUsed: boolean }> {
    const messages: DialogueMessage[] = [
      { role: "system", content: `${NADIM_PERSONALITY_PROMPT} Follow selectedLanguageStyle exactly. Compose a concise response using only supplied verified facts and recent dialogue. Never alter facts, claim unknown inventory, claim to be human, or claim an unconfirmed action.` },
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

  health() {
    return Promise.all([this.glm.health(), this.groq.health()]);
  }

  private async call<T>(taskType: string, messages: DialogueMessage[], jsonMode: boolean, map: (text: string) => T, trace: Trace): Promise<DialogueResult<T>> {
    const providers = this.providers();
    let lastError: unknown;
    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      const started = Date.now();
      try {
        const value = map(await provider.complete(messages, jsonMode));
        const latencyMs = Date.now() - started;
        void this.recordUsage(provider, taskType, latencyMs, true, index > 0, undefined, trace);
        return { value, provider: provider.provider, model: provider.model, fallbackUsed: index > 0, latencyMs };
      } catch (error) {
        lastError = error;
        void this.recordUsage(provider, taskType, Date.now() - started, false, index > 0, error instanceof DialogueProviderError ? error.code : "INVALID_OUTPUT", trace);
      }
    }
    throw lastError ?? new DialogueProviderError("none", "NOT_CONFIGURED", false);
  }

  private recordUsage(provider: DialogueProvider, taskType: string, latencyMs: number, success: boolean, fallbackUsed: boolean, errorCode: string | undefined, trace: Trace) {
    return this.usage?.record({
      provider: provider.provider,
      model: provider.model,
      taskType,
      latencyMs,
      success,
      fallbackUsed,
      errorCode,
      promptVersion: "nadim-v2.1-contextual",
      conversationId: trace.conversationId,
    });
  }
}
