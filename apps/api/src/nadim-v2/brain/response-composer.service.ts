import { Injectable, Optional } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { NADIM_CORE_PERSONALITY } from "../personality/nadim-personality";
import { ResponseStyleService } from "../personality/response-style.service";
import { DialogueModelService } from "../providers/dialogue-model.service";

export type CompositionResult = {
  reply: string;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number };
};

type CompositionInput = {
  userMessage: string;
  understanding: NadimUnderstanding;
  state: NadimState;
  plan: NadimPlan;
  toolResults: NadimToolResult[];
  proposedActions: ProposedAction[];
  executedActions: ExecutedAction[];
  trace?: { conversationId?: string; requestId?: string };
};

function dataOf(result?: NadimToolResult) {
  if (!result?.ok || result.data == null) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}

@Injectable()
export class ResponseComposerService {
  private readonly responseStyle: ResponseStyleService;

  constructor(
    private readonly dialogue: DialogueModelService,
    @Optional() responseStyle?: ResponseStyleService,
  ) {
    this.responseStyle = responseStyle ?? new ResponseStyleService();
  }

  async compose(input: CompositionInput): Promise<CompositionResult> {
    const fallback = this.deterministic(input);
    const deterministicRequired = input.plan.steps.length > 0
      || input.plan.goal === "PROPERTY_SEARCH"
      || Boolean(input.plan.clarification)
      || input.proposedActions.length > 0
      || input.executedActions.length > 0
      || input.state.languageStyle?.changedThisTurn
      || ["GREETING", "RESET_SEARCH"].includes(input.understanding.intent);
    if (deterministicRequired || !this.dialogue.available()) return { reply: fallback };
    try {
      const model = await this.dialogue.compose({
        userMessage: input.userMessage,
        intent: input.understanding,
        state: input.state,
        selectedLanguageStyle: input.state.languageStyle,
        personality: NADIM_CORE_PERSONALITY,
        verifiedFacts: input.toolResults.filter((result) => result.ok).map((result) => ({ tool: result.tool, data: result.data })),
        actionResults: input.executedActions,
        deterministicFallback: fallback,
      }, input.trace);
      if (!this.safeActionClaims(model.value, input.executedActions)) return { reply: fallback };
      if (!this.safeInventoryClaims(model.value, input.toolResults)) return { reply: fallback };
      return { reply: model.value, model: { provider: model.provider, model: model.model, fallbackUsed: model.fallbackUsed, latencyMs: model.latencyMs } };
    } catch {
      return { reply: fallback };
    }
  }

  private deterministic(input: CompositionInput) {
    const style = this.responseStyle.style(input.state);
    if (input.plan.clarification) return this.responseStyle.clarification(style, input.plan.clarification);
    if (input.executedActions.length) return this.responseStyle.actionResult(style, input.executedActions[0]);
    if (input.proposedActions.length) return this.responseStyle.proposedAction(style, input.proposedActions[0]);
    if (input.understanding.intent === "GREETING") return this.responseStyle.greeting(style, input.state.revision <= 1, input.userMessage);
    if (input.state.languageStyle?.changedThisTurn && ["UNKNOWN", "SMALL_TALK"].includes(input.understanding.intent)) return this.responseStyle.languageChanged(style);
    if (input.understanding.intent === "RESET_SEARCH") return this.responseStyle.reset(style);

    if (input.plan.goal === "PROPERTY_SEARCH") {
      const result = input.toolResults.find((item) => item.tool === "PROPERTY_SEARCH");
      if (!result) return this.responseStyle.searchNotRun(style);
      if (!result.ok || !Array.isArray(result.data)) return this.responseStyle.searchFailed(style);
      const change = input.understanding.intent === "MODIFY_SEARCH"
        ? this.responseStyle.operationSummary(style, input.state.lastOperations, input.state)
        : undefined;
      return result.data.length
        ? this.responseStyle.searchResults(style, result.data, change)
        : this.responseStyle.noMatch(style, this.responseStyle.searchBlocker(style, input.state), change);
    }

    if (input.plan.goal === "COMPARISON") {
      const result = input.toolResults.find((item) => item.tool === "COMPARE_PROPERTIES");
      return this.responseStyle.comparison(style, dataOf(result));
    }
    if (input.understanding.intent === "MEDIA_REQUEST") {
      const result = input.toolResults.find((item) => item.tool === "GET_MEDIA");
      const media = result?.ok && result.data && !Array.isArray(result.data) ? ((result.data as any).media ?? []) : [];
      return this.responseStyle.media(style, media.length, Boolean(result?.ok));
    }
    if (input.understanding.intent === "PAYMENT_PLAN_QUESTION") {
      const result = input.toolResults.find((item) => item.tool === "GET_PAYMENT_PLAN");
      return this.responseStyle.paymentPlans(style, dataOf(result), Boolean(result?.ok));
    }
    if (input.understanding.intent === "PRICE_QUESTION") {
      const result = input.toolResults.find((item) => item.tool === "GET_UNIT_FACTS");
      return this.responseStyle.price(style, dataOf(result)[0]);
    }
    if (input.understanding.intent === "AVAILABILITY_QUESTION") {
      const result = input.toolResults.find((item) => item.tool === "GET_AVAILABILITY");
      return this.responseStyle.availability(style, dataOf(result)[0]);
    }
    if (["PROPERTY_QUESTION", "LOCATION_QUESTION"].includes(input.understanding.intent)) {
      const result = input.toolResults.find((item) => item.tool === "GET_UNIT_FACTS" || item.tool === "GET_LOCATION");
      return result?.ok ? this.responseStyle.comparison(style, dataOf(result)) : this.responseStyle.unknown(style);
    }
    if (input.toolResults.some((result) => !result.ok)) return this.responseStyle.unknown(style);
    return this.responseStyle.safeFallback(style);
  }

  private safeActionClaims(reply: string, actions: ExecutedAction[]) {
    if (actions.some((action) => action.status === "SUCCEEDED")) return true;
    return !/(?:تم\s+(?:الحجز|التسجيل|الإرسال|تأكيد|تنفيذ)|اتسجل|تسجل|booked|reserved|successfully\s+(?:created|sent|scheduled|completed)|request\s+is\s+recorded)/iu.test(reply);
  }

  private safeInventoryClaims(reply: string, toolResults: NadimToolResult[]) {
    const claimsZeroInventory = /(?:ملقتش|ما\s+لقيت|مفيش\s+(?:نتائج|وحدات)|لا\s+توجد\s+(?:نتائج|وحدات)|mala2etsh|no\s+(?:results|available\s+units|inventory)|nothing\s+matched|didn[’']t\s+find\s+an?\s+exact\s+match)/iu.test(reply);
    if (!claimsZeroInventory) return true;
    const search = toolResults.find((result) => result.tool === "PROPERTY_SEARCH");
    return Boolean(search?.ok && Array.isArray(search.data) && search.data.length === 0);
  }
}
