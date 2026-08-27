import { Injectable, Optional } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { NADIM_CORE_PERSONALITY, NADIM_STYLE_PROFILES } from "../personality/nadim-personality";
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
  previousTurn?: { userMessage: string; assistantReply: string };
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
    const verifiedEmptySearch = this.verifiedEmptySearch(input);
    const searchResult = input.toolResults.find((result) => result.tool === "PROPERTY_SEARCH");
    const deterministicRequired = (!verifiedEmptySearch && input.plan.steps.length > 0)
      || (!verifiedEmptySearch && input.plan.goal === "PROPERTY_SEARCH")
      || Boolean(input.plan.clarification)
      || input.proposedActions.length > 0
      || input.executedActions.length > 0
      || input.state.languageStyle?.explicitRequestThisTurn
      || input.state.languageStyle?.grammaticalAddressChangedThisTurn
      || input.understanding.intent === "UNKNOWN"
      || [
        "GREETING", "ASSISTANT_IDENTITY", "ASSISTANT_CAPABILITIES", "LANGUAGE_CAPABILITY_QUERY",
        "LANGUAGE_STYLE_CHANGE", "RESET_SEARCH", "CURRENT_SEARCH_QUERY", "CORRECTION",
      ].includes(input.understanding.intent);
    if (deterministicRequired || !this.dialogue.available()) return { reply: fallback };
    try {
      const model = await this.dialogue.compose({
        userMessage: input.userMessage,
        intent: input.understanding,
        state: input.state,
        selectedLanguageStyle: input.state.languageStyle,
        styleProfile: NADIM_STYLE_PROFILES[input.state.languageStyle.preferredResponseStyle],
        personality: NADIM_CORE_PERSONALITY,
        verifiedFacts: input.toolResults.filter((result) => result.ok).map((result) => ({ tool: result.tool, data: result.data })),
        currentStateOperations: input.state.lastOperations,
        previousAssistantWording: input.state.recentAssistantWording,
        previousTurnSummary: input.previousTurn ? {
          user: input.previousTurn.userMessage.slice(0, 500),
          assistant: input.previousTurn.assistantReply.slice(0, 1_000),
        } : undefined,
        responseGoal: verifiedEmptySearch ? "VERIFIED_EMPTY_SEARCH" : input.plan.goal,
        searchExecution: {
          executed: Boolean(searchResult),
          succeeded: searchResult?.ok === true,
          verifiedResultCount: searchResult?.ok && Array.isArray(searchResult.data) ? searchResult.data.length : undefined,
        },
        actionResults: input.executedActions,
        deterministicFallback: fallback,
      }, input.trace);
      if (!this.safeActionClaims(model.value, input.executedActions)) return { reply: fallback };
      if (!this.safeInventoryClaims(model.value, input.toolResults)) return { reply: fallback };
      if (!this.safeStyleSurface(model.value, input.state.languageStyle.preferredResponseStyle)) return { reply: fallback };
      if (verifiedEmptySearch && !this.safeNoMatchComposition(model.value)) return { reply: fallback };
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
    if (input.understanding.intent === "ASSISTANT_IDENTITY") return this.responseStyle.assistantIdentity(style);
    if (input.understanding.intent === "ASSISTANT_CAPABILITIES") return this.responseStyle.assistantCapabilities(style, input.state.languageStyle.regionalVariant);
    if (input.understanding.intent === "LANGUAGE_CAPABILITY_QUERY") return this.responseStyle.languageCapability(style, input.userMessage, input.state.languageStyle.regionalVariant);
    if (input.understanding.intent === "LANGUAGE_STYLE_CHANGE") return this.responseStyle.languageChanged(style, input.state.languageStyle.regionalVariant);
    if (input.state.languageStyle?.grammaticalAddressChangedThisTurn && ["UNKNOWN", "SMALL_TALK"].includes(input.understanding.intent)) return this.responseStyle.addressChanged(style);
    if (input.understanding.intent === "RESET_SEARCH") return this.responseStyle.reset(style);
    if (input.understanding.intent === "UNKNOWN") return this.responseStyle.clarifyUnknown(style);
    if (input.understanding.intent === "CURRENT_SEARCH_QUERY") {
      return this.responseStyle.currentSearch(style, input.state, input.understanding.stateQuery);
    }
    if (input.understanding.intent === "SMALL_TALK") return this.responseStyle.smallTalk(style, input.userMessage, input.state.languageStyle.regionalVariant);
    if (input.understanding.intent === "CORRECTION"
      && input.state.lastOperations.some((operation) => operation.operation === "PRESERVE")) {
      return this.responseStyle.preservedSearch(style);
    }

    if (input.plan.goal === "PROPERTY_SEARCH") {
      const result = input.toolResults.find((item) => item.tool === "PROPERTY_SEARCH");
      if (!result) return this.responseStyle.searchNotRun(style);
      if (!result.ok || !Array.isArray(result.data)) return this.responseStyle.searchFailed(style);
      const change = input.understanding.intent === "MODIFY_SEARCH"
        ? this.responseStyle.operationSummary(style, input.state.lastOperations, input.state)
        : undefined;
      return result.data.length
        ? this.responseStyle.searchResults(style, result.data, change, input.state.languageStyle.grammaticalAddress)
        : this.responseStyle.noMatch(style, { change, previousAssistantWording: input.state.recentAssistantWording });
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
    const claimsZeroInventory = /(?:مش\s+(?:ظاهر|شايف)|ما\s+(?:ظهر|لقيت)|ملقتش|مفيش\s+(?:اختيار|نتائج|وحدات)|لا\s+(?:تظهر|يوجد|توجد)|لم\s+أجد|m(?:e)?sh\s+(?:zaher|shayef)|mala2etsh|ma\s+la2etsh|not\s+seeing|nothing\s+(?:suitable|useful)|no\s+(?:suitable|useful|results|available\s+units|inventory)|didn[’']t\s+find)/iu.test(reply);
    if (!claimsZeroInventory) return true;
    const search = toolResults.find((result) => result.tool === "PROPERTY_SEARCH");
    return Boolean(search?.ok && Array.isArray(search.data) && search.data.length === 0);
  }

  private verifiedEmptySearch(input: CompositionInput) {
    const search = input.toolResults.find((result) => result.tool === "PROPERTY_SEARCH");
    return input.plan.goal === "PROPERTY_SEARCH" && Boolean(search?.ok && Array.isArray(search.data) && search.data.length === 0);
  }

  private safeNoMatchComposition(reply: string) {
    const statesNoMatch = /(?:مش\s+(?:ظاهر|شايف)|ما\s+(?:ظهر|لقيت)|ملقتش|مفيش\s+(?:اختيار|حاجة|نتيجة|وحدة)|لا\s+(?:تظهر|يوجد|توجد)|لم\s+أجد|m(?:e)?sh\s+(?:zaher|shayef)|mala2etsh|ma\s+la2etsh|not\s+seeing|nothing\s+(?:suitable|useful)|no\s+(?:suitable|useful)|didn[’']t\s+find)/iu.test(reply);
    const inventsCause = /(?:main blocker|100%\s*match|exact match|your specified criteria|based on the current parameters|(?:budget|location|bedrooms?).{0,35}(?:too low|is the (?:issue|reason)|prevent|limit|block)|القيد (?:الرئيسي|الأبرز)|مطابقة 100%|المعايير المحددة|الشروط المحددة|(?:الميزانية|الموقع|المكان|الغرف).{0,35}(?:هي السبب|هو السبب|مقلل|مانع|المشكلة))/iu.test(reply);
    const inventsInventoryFact = /(?:\b(?:EGP|USD|AED)\b|\d[\d,.]*\s*(?:million|m|مليون)|(?:unit|project|compound)\s+(?:id|code|[A-Z][\w-]{2,})|(?:بسعر|سعرها|متاحة في مشروع))/iu.test(reply);
    return statesNoMatch && !inventsCause && !inventsInventoryFact;
  }

  private safeStyleSurface(reply: string, style: NadimState["languageStyle"]["preferredResponseStyle"]) {
    const hasArabic = /[\u0600-\u06FF]/u.test(reply);
    const hasLatin = /[A-Za-z]{2,}/u.test(reply);
    switch (style) {
      case "AR_EGYPTIAN":
        return hasArabic && !/(?:هذي|وش|ما راح|ما ظهر لي)/u.test(reply);
      case "AR_GULF":
        return hasArabic && !/(?:دلوقتي|ملقتش|معايا|مفيش|عايز)/u.test(reply);
      case "AR_FORMAL":
        return hasArabic && !/(?:دلوقتي|ملقتش|مفيش|هذي|وش|ما راح)/u.test(reply);
      case "EN_US":
        return hasLatin && !hasArabic;
      case "FRANCO_ARABIC":
        return hasLatin && !hasArabic && /(?:msh|mesh|zaher|shayef|mala2etsh|delwa2ty|momken|7aga|monaseb|tamam|nkamel)/iu.test(reply);
      case "MIXED_AR_EN":
        return hasArabic && hasLatin;
      default:
        return true;
    }
  }
}
