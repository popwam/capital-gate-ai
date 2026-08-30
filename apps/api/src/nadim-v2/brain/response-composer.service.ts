import { Injectable, Optional } from "@nestjs/common";
import { ExecutedAction, ProposedAction } from "../domain/nadim-action";
import { conversationStage, NadimConversationContext } from "../domain/nadim-conversation-context";
import { NadimUnderstanding } from "../domain/nadim-intent";
import { NadimPlan, NadimToolResult } from "../domain/nadim-plan";
import { NadimState } from "../domain/nadim-state";
import { NADIM_CORE_PERSONALITY, NADIM_STYLE_PROFILES } from "../personality/nadim-personality";
import { ResponseStyleService } from "../personality/response-style.service";
import { DialogueModelService } from "../providers/dialogue-model.service";
import { DialogueProviderChainError } from "../providers/dialogue-provider";

export type CompositionResult = {
  reply: string;
  model?: { provider: string; model: string; fallbackUsed: boolean; latencyMs: number };
  providerErrorCategory?: string;
  providerLatencyMs: number;
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
  conversationContext?: NadimConversationContext;
  trace?: { conversationId?: string; requestId?: string };
};

function dataOf(result?: NadimToolResult) {
  if (!result?.ok || result.data == null) return [];
  return Array.isArray(result.data) ? result.data : [result.data];
}

function compactCompositionState(state: NadimState, context?: NadimConversationContext) {
  return {
    channel: state.channel,
    locale: state.locale,
    stage: context?.stage ?? conversationStage(state),
    search: state.search,
    selectedUnitId: state.selectedUnitId,
    selectedProjectId: state.selectedProjectId,
    recentResultIds: state.lastResultIds.slice(0, 10),
    pendingClarification: state.pendingClarification,
    lastOperations: state.lastOperations,
    languageStyle: state.languageStyle,
  };
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
    const requirementHistory = this.requirementHistoryAnswer(input);
    if (requirementHistory) return { reply: requirementHistory, providerLatencyMs: 0 };
    const verifiedEmptySearch = this.verifiedEmptySearch(input);
    const searchResult = input.toolResults.find((result) => result.tool === "PROPERTY_SEARCH");
    if (!this.dialogue.available()) return { reply: fallback, providerErrorCategory: "NOT_CONFIGURED", providerLatencyMs: 0 };
    try {
      const model = await this.dialogue.compose({
        userMessage: input.userMessage,
        intent: input.understanding,
        state: compactCompositionState(input.state, input.conversationContext),
        recentDialogue: input.conversationContext?.recentTurns ?? [],
        conversationStage: input.conversationContext?.stage ?? conversationStage(input.state),
        lastVerifiedToolResultSummary: input.conversationContext?.lastVerifiedToolSummary,
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
        responseGoal: verifiedEmptySearch ? "VERIFIED_EMPTY_SEARCH" : input.understanding.responseGoal ?? input.plan.goal,
        responsePlan: input.understanding.responsePlan,
        referenceResolution: input.understanding.references,
        searchExecution: {
          executed: Boolean(searchResult),
          succeeded: searchResult?.ok === true,
          verifiedResultCount: searchResult?.ok && Array.isArray(searchResult.data) ? searchResult.data.length : undefined,
        },
        actionResults: input.executedActions,
        deterministicAnswer: fallback,
        deterministicFallback: fallback,
      }, input.trace);
      const attempts = model.attempts ?? [];
      const providerLatencyMs = model.latencyMs + attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0);
      const rejected = !this.safeHumanIdentity(model.value)
        || !this.safeAssistantSemantics(model.value, input.understanding.intent)
        || !this.safeStateQuery(model.value, input)
        || !this.safeActionClaims(model.value, input.executedActions)
        || !this.safeDeliveryAndProximityClaims(model.value, input)
        || !this.safeProposedActionStatus(model.value, input.proposedActions, input.executedActions)
        || !this.safeInventoryClaims(model.value, input.toolResults)
        || !this.safeStyleSurface(model.value, input.state.languageStyle.preferredResponseStyle)
        || (verifiedEmptySearch && !this.safeNoMatchComposition(model.value));
      if (rejected) return { reply: fallback, providerErrorCategory: "SAFETY_VALIDATION_REJECTED", providerLatencyMs };
      return {
        reply: model.value,
        model: { provider: model.provider, model: model.model, fallbackUsed: model.fallbackUsed, latencyMs: model.latencyMs },
        providerErrorCategory: attempts.at(-1)?.errorCategory,
        providerLatencyMs,
      };
    } catch (error) {
      return {
        reply: fallback,
        providerErrorCategory: error instanceof DialogueProviderChainError
          ? error.attempts.at(-1)?.errorCategory ?? "PROVIDER_CHAIN_FAILED"
          : "COMPOSITION_FAILED",
        providerLatencyMs: error instanceof DialogueProviderChainError
          ? error.attempts.reduce((sum, attempt) => sum + attempt.latencyMs, 0)
          : 0,
      };
    }
  }

  private requirementHistoryAnswer(input: CompositionInput) {
    const match = input.userMessage.match(/(?:طلبي|الطلب)\s+(الأول|الاول|التاني|الثاني|first|second)/iu);
    if (!match) return undefined;
    const requirements = (input.conversationContext?.customerContext?.propertyRequirements ?? []) as Array<Record<string, any>>;
    const index = /(?:التاني|الثاني|second)/iu.test(match[1]) ? 1 : 0;
    const requirement = requirements[index];
    if (!requirement) return this.responseStyle.clarification(this.responseStyle.style(input.state), "REQUIREMENT_REFERENCE_NOT_FOUND");
    const details = [
      requirement.propertyType,
      requirement.bedrooms != null ? `${requirement.bedrooms} غرف` : undefined,
      ...(Array.isArray(requirement.locations) ? requirement.locations : []),
      requirement.budgetMax != null ? `لحد ${Number(requirement.budgetMax).toLocaleString("en-US")} ${requirement.currency ?? ""}` : undefined,
    ].filter(Boolean).join(" · ");
    return input.state.languageStyle.preferredResponseStyle === "EN_US"
      ? `Your ${index === 0 ? "first" : "second"} requirement was: ${details}.`
      : `طلبك ${index === 0 ? "الأول" : "التاني"} كان: ${details}.`;
  }

  private deterministic(input: CompositionInput) {
    const style = this.responseStyle.style(input.state);
    if (input.plan.clarification) return this.responseStyle.clarification(style, input.plan.clarification);
    if (input.executedActions.length) return this.responseStyle.actionResult(style, input.executedActions[0]);
    if (input.proposedActions.length) return this.responseStyle.proposedAction(style, input.proposedActions[0]);
    if (input.understanding.intent === "GREETING") return this.responseStyle.greeting(style, input.state.revision <= 1, input.userMessage);
    if (input.understanding.intent === "ASSISTANT_IDENTITY") return this.responseStyle.assistantIdentity(style);
    if (input.understanding.intent === "ASSISTANT_NATURE") return this.responseStyle.assistantNature(style, input.state.languageStyle.regionalVariant);
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
      if (this.isProximityQuestion(input.userMessage) && !this.hasComparableProximityEvidence(dataOf(result))) {
        return this.responseStyle.unverifiedProximity(style);
      }
      return this.responseStyle.comparison(style, dataOf(result));
    }
    if (input.understanding.intent === "MEDIA_REQUEST") {
      const result = input.toolResults.find((item) => item.tool === "GET_MEDIA");
      const media = result?.ok && result.data && !Array.isArray(result.data) ? ((result.data as any).media ?? []) : [];
      const location = result?.ok && result.data && !Array.isArray(result.data) ? (result.data as any).location : undefined;
      return this.responseStyle.media(style, media, Boolean(result?.ok), input.userMessage, location);
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
    if (input.understanding.intent === "LOCATION_QUESTION") {
      const result = input.toolResults.find((item) => item.tool === "GET_UNIT_FACTS" || item.tool === "GET_LOCATION");
      const unit = dataOf(result)[0] as any;
      return this.responseStyle.location(style, unit?.project?.location ?? unit, Boolean(result?.ok));
    }
    if (input.understanding.intent === "PROPERTY_QUESTION") {
      const result = input.toolResults.find((item) => item.tool === "GET_UNIT_FACTS" || item.tool === "GET_LOCATION");
      return result?.ok ? this.responseStyle.comparison(style, dataOf(result)) : this.responseStyle.unknown(style);
    }
    if (input.toolResults.some((result) => !result.ok)) return this.responseStyle.unknown(style);
    return this.responseStyle.safeFallback(style);
  }

  private safeActionClaims(reply: string, actions: ExecutedAction[]) {
    const succeeded = new Set(actions.filter((action) => action.status === "SUCCEEDED").map((action) => action.type));
    const claimsDeletion = /(?:تم|جرى|اتعمل|اتمسح|deleted|removed).{0,30}(?:حذف|مسح|المحادثة|conversation|memory|ذاكرة)|(?:حذفت|مسحت).{0,20}(?:المحادثة|ذاكرة)/iu.test(reply);
    if (claimsDeletion && !succeeded.has("CONFIRM_CONVERSATION_DELETION")) return false;
    const claimsHandoff = /(?:حوّلت|حولت|تم التحويل|الفريق.{0,20}(?:هيكمل|سيكمل)|team member.{0,20}(?:take over|continue)|human.{0,20}(?:take over|joined))/iu.test(reply);
    if (claimsHandoff && !succeeded.has("HUMAN_HANDOFF")) return false;
    const claimsBooking = /(?:تم\s+(?:الحجز|تسجيل المعاينة)|اتحجز|اتسجلت المعاينة|booked|reserved|viewing.{0,20}(?:recorded|confirmed))/iu.test(reply);
    if (claimsBooking && !succeeded.has("CREATE_VIEWING_REQUEST") && !succeeded.has("CREATE_RESERVATION_REQUEST")) return false;
    const claimsFollowUp = /(?:هتابع|هكلمك|هفكرك|المتابعة\s+(?:اتسجلت|تمت)|follow-?up.{0,25}(?:scheduled|confirmed)|reminder.{0,20}(?:set|scheduled))/iu.test(reply);
    if (claimsFollowUp && !succeeded.has("CREATE_FOLLOWUP")) return false;
    const claimsHumanNotified = /(?:بلغت|اتبلغ|تم\s+إبلاغ|notified|alerted).{0,30}(?:الفريق|المبيعات|موظف|human|team|sales)/iu.test(reply);
    if (claimsHumanNotified && !succeeded.has("HUMAN_HANDOFF")) return false;
    if (succeeded.size) return true;
    return !/(?:تم\s+(?:الحجز|التسجيل|الإرسال|تأكيد|تنفيذ)|اتسجل|تسجل|booked|reserved|successfully\s+(?:created|sent|scheduled|completed)|request\s+is\s+recorded|I(?:['’]ve|\s+have)\s+(?:saved|recorded|scheduled)|(?:interest|follow-?up|callback|customer\s+details).{0,24}(?:saved|recorded|scheduled|created|confirmed))/iu.test(reply);
  }

  private safeDeliveryAndProximityClaims(reply: string, input: CompositionInput) {
    // Current customer transports expose verified URLs as text; they do not
    // execute binary media delivery. A send/delivery claim is therefore false.
    const claimsDelivery = /(?:بعت(?:لك|ت)?|هبعت(?:لك)?|أبعتلك|أرسلت|هبدأتلك|اترسل|هيوصلك|sent|delivered|I(?:'ll|\s+will)\s+send).{0,40}(?:صور|ماستر|بلان|لوكيشن|موقع|خريطة|photos?|images?|master\s*plan|floor\s*plan|location|map)/iu.test(reply);
    if (claimsDelivery) return false;
    const claimsProximity = /(?:أقرب|الأقرب|closer|closest|nearer).{0,80}(?:جامعة|auc|landmark|مكان|location)|(?:جامعة|auc|landmark).{0,80}(?:أقرب|الأقرب|closer|closest|nearer)/iu.test(reply);
    if (!claimsProximity) return true;
    const comparison = input.toolResults.find((result) => result.tool === "COMPARE_PROPERTIES");
    return Boolean(comparison?.ok && this.hasComparableProximityEvidence(dataOf(comparison)));
  }

  private isProximityQuestion(message: string) {
    return /(?:أقرب|الأقرب|مسافة|وقت\s*(?:الطريق|الوصول)|closer|closest|distance|travel\s*time|nearer)/iu.test(message);
  }

  private hasComparableProximityEvidence(units: any[]) {
    if (units.length < 2) return false;
    const targets = units.map((unit) => new Map((unit?.proximities ?? [])
      .filter((item: any) => item?.verifiedAt && item?.targetName && (item?.distanceMeters != null || item?.drivingMinutes != null || item?.walkingMinutes != null))
      .map((item: any) => [String(item.targetName).toLocaleLowerCase(), item])));
    return [...targets[0].keys()].some((target) => targets.every((map) => map.has(target)));
  }

  private safeProposedActionStatus(reply: string, proposals: ProposedAction[], actions: ExecutedAction[]) {
    if (!proposals.length || actions.length) return true;
    return /(?:لسه|لم |غير مؤكد|مو تأكيد|ما (?:تسجل|تأكد)|مش تأكيد|not (?:yet )?(?:confirmed|recorded|executed)|hasn['’]?t been|unconfirmed|lessa|mesh confirmed)/iu.test(reply);
  }

  private safeHumanIdentity(reply: string) {
    return !/(?:\bأنا\s+(?:إنسان|انسان|بشر|بني\s+آدم|بني\s+ادم|شخص\s+حقيقي|موظف\s+بشري)\b|\bI(?:['’]m|\s+am)\s+(?:a\s+)?(?:human|real\s+person|human\s+agent)\b)/iu.test(reply);
  }

  private safeAssistantSemantics(reply: string, intent: NadimUnderstanding["intent"]) {
    if (intent === "ASSISTANT_IDENTITY") return /(?:نديم|Nadim)/iu.test(reply);
    if (intent !== "ASSISTANT_NATURE") return true;
    const transparent = /(?:ذكاء\s+اصطناعي|مساعد\s+(?:افتراضي|رقمي)|\bAI\b|artificial\s+intelligence)/iu.test(reply);
    return transparent && /(?:نديم|Nadim)/iu.test(reply);
  }

  private safeStateQuery(reply: string, input: CompositionInput) {
    if (input.understanding.intent !== "CURRENT_SEARCH_QUERY") return true;
    const target = input.understanding.stateQuery ?? "SEARCH";
    const search = input.state.search;
    if (target === "SELECTED_RESULT") {
      const ordinal = input.state.selectedUnitId ? input.state.lastResultIds.indexOf(input.state.selectedUnitId) + 1 : 0;
      if (ordinal > 0) return new RegExp(`(?:^|\\D)${ordinal}(?:\\D|$)`, "u").test(reply);
      if (input.state.selectedUnitId) return /(?:وحدة\s+محددة|اختيار\s+محفوظ|specific\s+unit|selected\s+unit|wa7da\s+mo3ayana)/iu.test(reply);
      return /(?:لسه|ما\s+اختر|لم\s+نختر|haven['’]?t\s+selected|not\s+selected|ma\s+e5tarnash)/iu.test(reply);
    }
    if (target === "budgetMax") {
      return search.budgetMax === undefined
        ? /(?:لسه|ما\s+حدد|لم\s+نحدد|haven['’]?t\s+set|not\s+set|ma\s+7adad)/iu.test(reply)
        : this.containsAmount(reply, search.budgetMax);
    }
    if (target === "bedrooms") {
      return search.bedrooms === undefined
        ? /(?:لسه|ما\s+حدد|لم\s+نحدد|haven['’]?t\s+set|not\s+set|ma\s+7adad)/iu.test(reply)
        : new RegExp(`(?:^|\\D)${search.bedrooms}(?:\\D|$)`, "u").test(reply);
    }
    if (target === "locations") {
      return search.locations.length === 0
        ? /(?:لسه|ما\s+حدد|لم\s+نحدد|haven['’]?t\s+set|not\s+set|ma\s+7adad)/iu.test(reply)
        : search.locations.every((location) => reply.toLocaleLowerCase().includes(location.toLocaleLowerCase()));
    }
    const expectedChecks = [
      ...search.locations.map((location) => reply.toLocaleLowerCase().includes(location.toLocaleLowerCase())),
      ...(search.bedrooms === undefined ? [] : [new RegExp(`(?:^|\\D)${search.bedrooms}(?:\\D|$)`, "u").test(reply)]),
      ...(search.budgetMax === undefined ? [] : [this.containsAmount(reply, search.budgetMax)]),
      ...search.propertyTypes.map((type) => type === "Apartment" ? /(?:شقة|apartment|sho2a)/iu.test(reply) : type === "Villa" ? /(?:فيلا|villa)/iu.test(reply) : reply.toLocaleLowerCase().includes(type.toLocaleLowerCase())),
    ];
    return expectedChecks.length === 0
      ? /(?:لسه|ما\s+حدد|لم\s+نحدد|haven['’]?t\s+set|not\s+set|ma\s+7adad)/iu.test(reply)
      : expectedChecks.every(Boolean);
  }

  private containsAmount(reply: string, amount: number) {
    const full = Math.trunc(amount).toLocaleString("en-US");
    if (reply.includes(full) || reply.includes(String(Math.trunc(amount)))) return true;
    const millions = amount / 1_000_000;
    return Number.isInteger(millions)
      ? new RegExp(`(?:^|\\D)${millions}(?:\\s*(?:مليون|million|m)\\b|(?:\\D|$))`, "iu").test(reply)
      : reply.includes(String(millions));
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
