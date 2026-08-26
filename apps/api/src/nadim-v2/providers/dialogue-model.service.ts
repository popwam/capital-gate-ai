import { Injectable, Optional } from "@nestjs/common";
import { AIUsageService } from "../../providers/ai-usage.service";
import { NadimUnderstanding } from "../domain/nadim-intent";
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

@Injectable()
export class DialogueModelService {
  constructor(
    private readonly glm: BedrockGlmProvider,
    private readonly groq: GroqDialogueProvider,
    @Optional() private readonly usage?: AIUsageService,
  ) {}

  private providers() {
    return [this.glm, this.groq].filter((provider, index, values) => provider.enabled() && values.findIndex((item) => item.provider === provider.provider) === index);
  }

  available() {
    return this.providers().length > 0;
  }

  async understand(message: string, state: NadimState, trace: Trace = {}): Promise<DialogueResult<unknown>> {
    const messages: DialogueMessage[] = [
      {
        role: "system",
        content: [
          "You are Nadim V2's language understanding component, not the decision maker.",
          "Return one JSON object only. Resolve short current-turn references against currentState before choosing UNKNOWN, while extracting only changes or questions actually expressed this turn.",
          "Allowed operations are SET, REMOVE, RESET, PRESERVE. Never silently widen or preserve a removed value.",
          "Allowed state fields: locations, projects, developers, propertyTypes, bedrooms, bathrooms, areaMin, areaMax, budgetMin, budgetMax, currency, downPaymentMax, installmentMonths, installmentPreference, deliveryMaxYears, purpose, finishing, queryObjective, SEARCH. installmentPreference is INSTALLMENTS or LONG_TERM; never invent installmentMonths from vague wording such as long installments.",
          "Intent must be one of the documented Nadim V2 intents. Confidence is 0..1. Ordinals are one-based. For a CURRENT_SEARCH_QUERY, set stateQuery to the requested field or SEARCH for a summary and return no operations; the answer will be read deterministically from currentState.",
          "A short dominant reference such as make it 10 million may resolve to an active budget. If multiple references are genuinely plausible, return ambiguity instead of guessing. A rejection of a proposed relaxation preserves state and runs no search. A greeting is GREETING even when state is active.",
          "A language-only or grammatical-address-only request has no search operations. Unintelligible input is UNKNOWN with no operations even when prior search state exists.",
        ].join(" "),
      },
      { role: "user", content: JSON.stringify({ message, currentState: state }) },
    ];
    return this.call("NADIM_V2_UNDERSTAND", messages, true, (text) => JSON.parse(stripFence(text)), trace);
  }

  async compose(input: Record<string, unknown>, trace: Trace = {}): Promise<DialogueResult<string>> {
    const messages: DialogueMessage[] = [
      {
        role: "system",
        content: `${NADIM_PERSONALITY_PROMPT} Apply the supplied styleProfile exactly. Treat verifiedFacts, current state, searchExecution, and actionResults as read-only. If an action did not SUCCEED, it was not completed.`,
      },
      { role: "user", content: JSON.stringify(input) },
    ];
    return this.call("NADIM_V2_COMPOSE", messages, false, (text) => text.trim(), trace);
  }

  async *composeStream(input: Record<string, unknown>): AsyncIterable<{ chunk: string; provider: string; model: string; fallbackUsed: boolean }> {
    const messages: DialogueMessage[] = [
      { role: "system", content: `${NADIM_PERSONALITY_PROMPT} Follow selectedLanguageStyle exactly. Compose a concise response using only supplied verified facts. Never alter facts, claim unknown inventory, or claim an unconfirmed action.` },
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
      promptVersion: "nadim-v2.0",
      conversationId: trace.conversationId,
    });
  }
}
