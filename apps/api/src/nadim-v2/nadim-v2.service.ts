import { Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ActionPolicyService } from "./brain/action-policy.service";
import { ConversationControlService, ControlDecision } from "./brain/conversation-control.service";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { ToolExecutorService } from "./brain/tool-executor.service";
import { ToolLoopService, ToolLoopResult } from "./brain/tool-loop.service";
import { UnderstandingResult, UnderstandingService } from "./brain/understanding.service";
import { ExecutedAction, NadimConversationMode, ProposedAction } from "./domain/nadim-action";
import { NadimTurnResult } from "./domain/nadim-result";
import { buildNadimUi } from "./domain/nadim-ui";
import { NadimTurnDto } from "./dto/nadim-turn.dto";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { nadimTurnRequestHash, NadimConversationService } from "./persistence/nadim-conversation.service";
import { CustomerLifecycleService } from "./product/customer-lifecycle.service";
import { FxRateService } from "./product/fx-rate.service";
import { followUpTransition, reservationTransition } from "./product/customer-journey";

function safeDiagnosticMeaning(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/gu, "[phone]")
    .replace(/\b[\w-]{32,}\b/gu, "[identifier]")
    .slice(0, 240);
}

function explicitlyStartsAnotherRequirement(message: string) {
  return /(?:طلب\s+(?:تاني|ثاني|جديد|مستقل)|عندي\s+(?:كمان\s+)?طلب|كمان\s+(?:عايز|عاوز|أبي|ابغى)|another\s+(?:request|requirement)|separate\s+(?:request|requirement))/iu.test(message);
}

function normalizedReference(value: unknown) {
  return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[أإآ]/gu, "ا").replace(/ة/gu, "ه").replace(/[^\p{L}\p{N}.]+/gu, " ").trim();
}

function requestedRequirement(message: string, requirements: Array<Record<string, any>>) {
  if (!/(?:ارجع|إرجع|كمل|كمّل|حوّل|حول|افتح|switch|return|continue|go\s+back).{0,36}(?:طلب|requirement)|(?:طلب|requirement).{0,24}(?:الأول|الاول|التاني|الثاني|first|second|شقة|فيلا|apartment|villa)/iu.test(message)) return undefined;
  const text = normalizedReference(message);
  const ordinal = /(?:الثاني|التاني|second)/iu.test(message) ? 2 : /(?:الاول|الأول|first)/iu.test(message) ? 1 : undefined;
  if (ordinal) return { requirement: requirements[ordinal - 1], reason: requirements[ordinal - 1] ? undefined : "REQUIREMENT_REFERENCE_NOT_FOUND" };
  const type = /(?:فيلا|villa)/iu.test(message) ? "villa" : /(?:شقه|شقة|apartment|flat)/iu.test(message) ? "apartment" : undefined;
  const candidates = requirements.filter((requirement) => {
    const propertyType = normalizedReference(requirement.propertyType);
    const title = normalizedReference(requirement.title);
    return type ? propertyType.includes(type) || title.includes(type) || (type === "apartment" && (propertyType.includes("شقه") || title.includes("شقه"))) || (type === "villa" && (propertyType.includes("فيلا") || title.includes("فيلا"))) : title.length > 2 && text.includes(title);
  });
  return candidates.length === 1
    ? { requirement: candidates[0] }
    : { reason: candidates.length > 1 ? "REQUIREMENT_REFERENCE_AMBIGUOUS" : "REQUIREMENT_REFERENCE_NOT_FOUND" };
}

function stateFromRequirement(previous: any, requirement: Record<string, any>) {
  const delivery = String(requirement.deliveryPreference ?? "").match(/WITHIN_(\d+)_YEARS/u)?.[1];
  return {
    ...previous,
    search: {
      locations: Array.isArray(requirement.locations) ? requirement.locations : [],
      projects: Array.isArray(requirement.preferredProjects) ? requirement.preferredProjects : [],
      developers: Array.isArray(requirement.preferredDevelopers) ? requirement.preferredDevelopers : [],
      propertyTypes: requirement.propertyType ? [String(requirement.propertyType)] : [],
      bedrooms: requirement.bedrooms ?? undefined,
      bathrooms: requirement.bathrooms ?? undefined,
      areaMin: requirement.areaMin ?? undefined,
      areaMax: requirement.areaMax ?? undefined,
      budgetMin: requirement.budgetMin ?? undefined,
      budgetMax: requirement.budgetMax ?? undefined,
      currency: requirement.currency ?? undefined,
      budget: requirement.budgetOriginalAmount != null ? {
        originalAmount: Number(requirement.budgetOriginalAmount),
        originalCurrency: String(requirement.budgetOriginalCurrency ?? requirement.currency ?? "EGP"),
        normalizedAmount: requirement.budgetNormalizedAmount == null ? undefined : Number(requirement.budgetNormalizedAmount),
        normalizedCurrency: requirement.budgetNormalizedCurrency === "EGP" ? "EGP" : undefined,
        fxRate: requirement.fxRate == null ? undefined : Number(requirement.fxRate),
        fxAsOf: requirement.fxAsOf ? new Date(requirement.fxAsOf).toISOString() : undefined,
        fxSource: requirement.fxSource ?? undefined,
        fxStatus: requirement.budgetNormalizedAmount == null ? "UNAVAILABLE" : "VERIFIED",
      } : undefined,
      purpose: requirement.purpose ?? undefined,
      installmentPreference: requirement.paymentPreference ?? undefined,
      deliveryMaxYears: delivery ? Number(delivery) : undefined,
    },
    selectedUnitId: requirement.selectedUnitId ?? undefined,
    selectedProjectId: requirement.selectedProjectId ?? undefined,
    comparisonUnitIds: Array.isArray(requirement.comparisonUnitIds) ? requirement.comparisonUnitIds : [],
    lastResultIds: Array.isArray(requirement.recentResultIds) ? requirement.recentResultIds : [],
    pendingClarification: undefined,
  };
}

@Injectable()
export class NadimV2Service {
  private readonly logger = new Logger(NadimV2Service.name);
  private readonly languageStyles: LanguageStyleDetectorService;

  constructor(
    private readonly conversations: NadimConversationService,
    private readonly understanding: UnderstandingService,
    private readonly stateEngine: StateEngineService,
    private readonly planner: PlannerService,
    private readonly tools: ToolExecutorService,
    private readonly actionPolicy: ActionPolicyService,
    private readonly composer: ResponseComposerService,
    @Optional() languageStyles?: LanguageStyleDetectorService,
    @Optional() private readonly toolLoop?: ToolLoopService,
    @Optional() private readonly controls?: ConversationControlService,
    @Optional() private readonly lifecycle?: CustomerLifecycleService,
    @Optional() private readonly fx?: FxRateService,
  ) {
    this.languageStyles = languageStyles ?? new LanguageStyleDetectorService();
  }

  async turn(input: NadimTurnDto, requestId: string = randomUUID(), idempotencyKey?: string): Promise<NadimTurnResult> {
    if (process.env.NADIM_V2_ENABLED !== "true") {
      throw new ServiceUnavailableException({ code: "NADIM_V2_DISABLED", message: "Nadim V2 is disabled", safe: true });
    }
    const started = Date.now();
    const requestHash = idempotencyKey ? nadimTurnRequestHash(input) : undefined;
    if (idempotencyKey && requestHash) {
      const replay = await this.conversations.replayIdempotent(input.channel, idempotencyKey, requestHash);
      if (replay) return replay;
    }

    const handoffToken = input.channel === "WHATSAPP" && input.externalUserId
      ? input.message.match(/\bnwh_[A-Za-z0-9_-]{43}\b/u)?.[0]
      : undefined;
    if (handoffToken && this.lifecycle && input.externalUserId) {
      const linked = await this.lifecycle.consumeToken({
        token: handoffToken,
        expectedType: ["WHATSAPP_HANDOFF", "WHATSAPP_JOIN"],
        channel: "WHATSAPP",
        externalUserId: input.externalUserId,
      });
      input = { ...input, conversationId: linked.conversationId, message: "Continue this existing conversation from WhatsApp." };
    }

    const resolveStarted = Date.now();
    const resolved = await this.conversations.resolve(input);
    const databaseLatencyMs = Date.now() - resolveStarted;
    const currentMode = (resolved.mode ?? resolved.conversation.mode ?? "AI") as NadimConversationMode;
    let claimedTurnId: string | undefined;
    if (idempotencyKey && requestHash) {
      const claim = await this.conversations.claimIdempotent({
        conversationId: resolved.conversation.id,
        channel: input.channel,
        idempotencyKey,
        requestHash,
        requestId,
        userMessage: input.message,
      });
      if (claim.replay) return claim.replay;
      claimedTurnId = claim.turnId;
    }

    try {
      const trace = { requestId, conversationId: resolved.conversation.id };
      let ownershipUnderstanding: UnderstandingResult | undefined;
      if (currentMode === "HUMAN" && input.controlCommand !== "RETURN_TO_AI") {
        ownershipUnderstanding = await this.understanding.understand(
          input.message,
          resolved.state,
          trace,
          resolved.conversationContext,
        );
        const explicitlyReturnsToAi = ownershipUnderstanding.brainDecision?.understood === true
          && ownershipUnderstanding.brainDecision.confidence >= 0.85
          && ownershipUnderstanding.brainDecision.proposedActions
            .some((action) => action.type === "RETURN_TO_AI");
        if (!explicitlyReturnsToAi || !this.controls) {
          return await this.persistSuppressed({
            input,
            requestId,
            requestHash,
            idempotencyKey,
            claimedTurnId,
            resolved,
            started,
            ownershipUnderstanding,
          });
        }
      }

      let mode = currentMode;
      let reactivationControl: ControlDecision | undefined;
      if (currentMode === "HUMAN" && this.controls) {
        reactivationControl = await this.controls.apply({
          conversationId: resolved.conversation.id,
          mode: currentMode,
          command: input.controlCommand,
          understanding: ownershipUnderstanding?.understanding,
          pendingDeletion: resolved.conversationContext?.pendingDeletion,
          hasIdempotencyKey: Boolean(idempotencyKey),
        });
        mode = reactivationControl.mode;
      }

      const detectedState = this.languageStyles.apply(resolved.state, input.message, input.locale);
      const brainInputState = detectedState.languageStyle.explicitRequestThisTurn
        ? {
            ...detectedState,
            languageStyle: {
              ...detectedState.languageStyle,
              preferredResponseStyle: resolved.state.languageStyle.preferredResponseStyle,
              regionalVariant: resolved.state.languageStyle.regionalVariant,
              explicitRequestThisTurn: false,
              changedThisTurn: false,
            },
          }
        : detectedState;
      const understood = ownershipUnderstanding
        ?? await this.understanding.understand(input.message, brainInputState, trace, resolved.conversationContext);
      let styledPrevious = understood.brainDecision
        ? this.languageStyles.applySemanticRequest(brainInputState, understood.understanding.responseStyleRequest ?? undefined)
        : detectedState;
      const requirements = (resolved.conversationContext?.customerContext?.propertyRequirements ?? []) as Array<Record<string, any>>;
      const beginsIndependentRequirement = explicitlyStartsAnotherRequirement(input.message);
      const requirementRequest = beginsIndependentRequirement ? undefined : requestedRequirement(input.message, requirements);
      let switchedRequirementId: string | undefined;
      if (requirementRequest && this.lifecycle) {
        if (requirementRequest.requirement?.id) {
          const requirement = await this.lifecycle.activateRequirement(resolved.conversation.id, String(requirementRequest.requirement.id));
          styledPrevious = stateFromRequirement(styledPrevious, requirementRequest.requirement);
          switchedRequirementId = String(requirement.id);
          resolved.conversationContext.customerContext = { ...resolved.conversationContext.customerContext, activeRequirementId: requirement.id };
          understood.understanding.intent = "CURRENT_SEARCH_QUERY";
          understood.understanding.operations = [{ operation: "PRESERVE", field: "SEARCH" }];
          understood.understanding.stateQuery = "SEARCH";
          understood.understanding.stateQueries = ["SEARCH"];
          understood.understanding.needsClarification = false;
          understood.understanding.clarificationReason = undefined;
          understood.understanding.responseGoal = "CONFIRM_ACTIVE_REQUIREMENT_AND_SUMMARIZE";
        } else {
          understood.understanding.needsClarification = true;
          understood.understanding.clarificationReason = requirementRequest.reason;
          understood.understanding.ambiguity = requirementRequest.reason;
        }
      }
      const awaitingIndependentRequirement = resolved.state.pendingClarification?.reason === "NEW_REQUIREMENT_EXPECTED";
      const startsIndependentRequirement = beginsIndependentRequirement || awaitingIndependentRequirement;
      const stateBeforeOperations = startsIndependentRequirement
        ? { ...styledPrevious, search: { locations: [], projects: [], developers: [], propertyTypes: [] }, selectedUnitId: undefined, selectedProjectId: undefined, comparisonUnitIds: [], lastResultIds: [], pendingClarification: undefined }
        : styledPrevious;
      let state = this.stateEngine.apply(stateBeforeOperations, understood.understanding, {
        channel: input.channel,
        customerId: resolved.customerId,
        externalUserId: input.externalUserId,
        locale: input.locale,
      });
      state = await this.normalizeBudget(state);

      const profile = resolved.conversationContext?.customerContext?.customerProfile as { name?: string | null; normalizedPhone?: string | null } | undefined;
      const reservation = reservationTransition({
        state,
        message: input.message,
        reservationIntent: understood.understanding.intent === "RESERVATION_REQUEST",
        profile: { name: profile?.name, phone: profile?.normalizedPhone },
      });
      let reservationBlocked = false;
      if (reservation?.pendingAction) {
        state = { ...state, pendingAction: reservation.pendingAction };
        if (reservation.clarification) state.pendingClarification = { reason: reservation.clarification };
        if (this.lifecycle && (reservation.pendingAction.collectedFields.fullName || reservation.pendingAction.collectedFields.phone)) {
          try {
            const contact = await this.lifecycle.saveCustomerContact({
              conversationId: resolved.conversation.id,
              channel: input.channel,
              externalUserId: input.externalUserId,
              name: reservation.pendingAction.collectedFields.fullName,
              phone: reservation.pendingAction.collectedFields.phone,
            });
            state.customerId = contact.id;
          } catch (error) {
            const response = typeof (error as { getResponse?: unknown })?.getResponse === "function"
              ? (error as { getResponse: () => unknown }).getResponse()
              : undefined;
            const code = response && typeof response === "object" ? (response as { code?: unknown }).code : undefined;
            if (code !== "CUSTOMER_PHONE_CONFLICT" || !state.pendingAction) throw error;
            reservationBlocked = true;
            const collectedFields = { ...state.pendingAction.collectedFields, phone: undefined };
            state = {
              ...state,
              pendingAction: { ...state.pendingAction, collectedFields, missingFields: [...new Set([...state.pendingAction.missingFields, "phone" as const])] },
              pendingClarification: { reason: "RESERVATION_PHONE_CONFLICT" },
            };
          }
        }
      }

      const followUp = followUpTransition({ state, message: input.message, profilePhone: profile?.normalizedPhone });
      if (followUp) {
        state = { ...state, pendingFollowUp: followUp.pendingFollowUp };
        if (followUp.clarification) state.pendingClarification = { reason: followUp.clarification };
        else if (!followUp.scheduling && followUp.pendingFollowUp.channel) state.pendingClarification = { reason: "FOLLOWUP_TIME_REQUIRED" };
        const actions = (understood.understanding.proposedActions ?? []).filter((action) => action.type !== "CREATE_FOLLOWUP");
        if (followUp.ready && followUp.pendingFollowUp.temporal) {
          actions.push({
            type: "CREATE_FOLLOWUP",
            reason: "Customer explicitly requested a scheduled follow-up",
            payload: {
              temporal: followUp.pendingFollowUp.temporal,
              channel: followUp.pendingFollowUp.channel ?? input.channel,
              outboundAddress: followUp.pendingFollowUp.outboundAddress,
              sourceText: input.message.slice(0, 500),
            },
          });
          state.pendingClarification = undefined;
        }
        understood.understanding.proposedActions = actions;
      }
      if (beginsIndependentRequirement && !this.hasRequirementCriteria(state)) {
        state = { ...state, pendingClarification: { reason: "NEW_REQUIREMENT_EXPECTED" } };
      }

      let control: ControlDecision = reactivationControl ?? { mode, suppressReply: false, deleteConfirmed: false };
      if (this.controls && !reactivationControl) {
        control = await this.controls.apply({
          conversationId: resolved.conversation.id,
          mode,
          command: input.controlCommand,
          understanding: understood.understanding,
          pendingDeletion: resolved.conversationContext?.pendingDeletion,
          hasIdempotencyKey: Boolean(idempotencyKey),
        });
        mode = control.mode;
      }

      // A qualified customer brief is lifecycle data, not a side effect of a
      // successful inventory lookup. Persist it before any search can fail.
      const persistedRequirement = !control.action && this.lifecycle
        && ["PROPERTY_SEARCH", "MODIFY_SEARCH"].includes(understood.understanding.intent)
        && this.hasRequirementCriteria(state)
        ? await this.lifecycle.saveRequirement({
            conversationId: resolved.conversation.id,
            channel: input.channel,
            externalUserId: input.externalUserId,
            state,
            status: "OPEN",
            allowNew: startsIndependentRequirement,
          })
        : undefined;

      let plan = control.action
        ? { goal: control.action, steps: [] }
        : this.planner.plan(understood.understanding, state);
      if (!control.action && !reservationBlocked && reservation?.shouldSubmit && reservation.pendingAction?.collectedFields.paymentMethod === "PROJECT_PAYMENT_PLAN") {
        plan = {
          ...plan,
          clarification: undefined,
          steps: [...plan.steps.filter((step) => step.tool !== "GET_PAYMENT_PLAN"), { tool: "GET_PAYMENT_PLAN" as const, arguments: { unitId: reservation.pendingAction.unitId } }].slice(0, 4),
        };
      }
      const loop = await this.executeToolLoop(plan, state, understood.brainDecision, trace);
      const toolResults = loop.results;
      const finalDecision = loop.finalDecision;
      if (finalDecision) {
        understood.understanding.responseGoal = finalDecision.conversationalGoal;
        understood.understanding.responsePlan = finalDecision.responsePlan;
        const existingActions = understood.understanding.proposedActions ?? [];
        understood.understanding.proposedActions = [...existingActions, ...finalDecision.proposedActions]
          .filter((action, index, all) => all.findIndex((candidate) => candidate.type === action.type) === index);
      }

      const verifiedResults = toolResults
        .filter((result) => result.ok)
        .flatMap((result) => Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data]) as any[];
      const propertySearchResult = toolResults.find((result) => result.tool === "PROPERTY_SEARCH" && result.ok);
      if (propertySearchResult) {
        const searchRows = Array.isArray(propertySearchResult.data) ? propertySearchResult.data : [];
        state = this.stateEngine.withResults(state, searchRows.map((item: any) => item?.id).filter(Boolean));
        if (persistedRequirement && this.lifecycle) {
          await this.lifecycle.setRequirementStatus(persistedRequirement.id, searchRows.length ? "MATCHED" : "NEEDS_MATCH");
        }
      }
      const referencedToolResult = toolResults.find((result) => ["GET_UNIT_FACTS", "GET_PAYMENT_PLAN", "GET_AVAILABILITY", "GET_MEDIA"].includes(result.tool) && result.ok)?.data as {
        id?: string;
        unitId?: string;
        unit?: { id?: string };
      } | undefined;
      const referencedUnitId = referencedToolResult?.unit?.id ?? referencedToolResult?.unitId ?? referencedToolResult?.id;
      if (understood.understanding.unitReference && referencedUnitId) {
        state = { ...state, selectedUnitId: referencedUnitId };
      }

      let proposedActions: ProposedAction[] = control.action ? [] : this.actionPolicy.propose(understood.understanding, state)
        .filter((action) => !(persistedRequirement && action.type === "SAVE_PROPERTY_REQUIREMENT"));
      proposedActions = proposedActions.filter((action) => action.type !== "CREATE_RESERVATION_REQUEST");
      if (!control.action && !reservationBlocked && reservation?.shouldSubmit && reservation.pendingAction) {
        const verifiedPayment = toolResults.find((result) => result.tool === "GET_PAYMENT_PLAN" && result.ok)?.data as { unit?: { id?: string }; plans?: unknown[] } | undefined;
        if (verifiedPayment?.unit?.id === reservation.pendingAction.unitId && verifiedPayment.plans?.length) {
          proposedActions.push({
            type: "CREATE_RESERVATION_REQUEST",
            reason: "Customer supplied every required reservation-request field",
            payload: {
              unitId: reservation.pendingAction.unitId,
              fullName: reservation.pendingAction.collectedFields.fullName,
              phone: reservation.pendingAction.collectedFields.phone,
              paymentMethod: reservation.pendingAction.collectedFields.paymentMethod,
              verifiedPaymentPlans: verifiedPayment.plans,
            },
          });
        } else {
          state.pendingClarification = { reason: "RESERVATION_PAYMENT_PLAN_UNAVAILABLE" };
        }
      }
      const actionStarted = Date.now();
      const externalActions = control.action ? [] : await this.actionPolicy.execute(proposedActions, {
        channel: input.channel,
        customerId: state.customerId,
        externalUserId: input.externalUserId,
        conversationId: resolved.conversation.id,
        requestId: idempotencyKey && requestHash
          ? `nadim-${createHash("sha256").update(`${input.channel}:${idempotencyKey}:${requestHash}`, "utf8").digest("hex")}`
          : requestId,
        state,
      });
      const actionLatencyMs = Date.now() - actionStarted;
      const executedActions: ExecutedAction[] = [...(control.executed ? [control.executed] : []), ...externalActions];
      const reservationResult = executedActions.find((action) => action.type === "CREATE_RESERVATION_REQUEST");
      if (reservationResult?.status === "SUCCEEDED") state = { ...state, pendingAction: undefined };
      else if (reservationResult && state.pendingAction) state = {
        ...state,
        pendingAction: {
          ...state.pendingAction,
          lastExecutionStatus: reservationResult.status === "FAILED" ? "FAILED" : "NOT_EXECUTED",
          lastErrorCode: reservationResult.errorCode,
        },
      };
      if (executedActions.some((action) => action.type === "CREATE_FOLLOWUP" && action.status === "SUCCEEDED")) {
        state = { ...state, pendingFollowUp: undefined };
      }

      const activeRequirementId = persistedRequirement?.id
        ?? switchedRequirementId
        ?? resolved.conversationContext?.customerContext?.activeRequirementId;
      if (activeRequirementId && this.lifecycle && typeof (this.lifecycle as any).updateRequirementContext === "function") {
        await this.lifecycle.updateRequirementContext(resolved.conversation.id, String(activeRequirementId), state);
      }

      const compositionStarted = Date.now();
      const composed = await this.composer.compose({
        userMessage: input.message,
        understanding: understood.understanding,
        state,
        plan,
        toolResults,
        proposedActions,
        executedActions,
        previousTurn: resolved.previousTurn,
        conversationContext: { ...resolved.conversationContext, mode },
        trace,
        structuredPresentation: input.channel === "WEB",
      });
      const compositionLatencyMs = Date.now() - compositionStarted;
      state = this.stateEngine.withAssistantWording(state, composed.reply);

      const primaryModel = understood.model;
      const finalModel = composed.model ?? loop.model ?? primaryModel;
      const fallbackUsed = Boolean(primaryModel?.fallbackUsed || loop.model?.fallbackUsed || composed.model?.fallbackUsed || !primaryModel);
      const providerLatencyMs = (understood.providerLatencyMs ?? 0) + loop.providerLatencyMs + (composed.providerLatencyMs ?? 0);
      const providerErrorCategory = composed.providerErrorCategory ?? loop.providerErrorCategory ?? understood.providerErrorCategory;
      const understoodMeaning = safeDiagnosticMeaning(understood.understanding.understoodMeaning);
      const toolDecision = plan.steps.length ? "EXECUTE" as const : plan.clarification ? "CLARIFY" as const : "NO_TOOL" as const;
      const latencyMs = Date.now() - started;
      const toolLatencyMs = toolResults.reduce((sum, result) => sum + result.latencyMs, 0);
      const response: NadimTurnResult = {
        ok: true,
        version: "v2",
        replayed: false,
        conversationId: resolved.conversation.id,
        reply: composed.reply,
        suppressReply: false,
        mode,
        deleted: control.deleteConfirmed || undefined,
        intent: { type: understood.understanding.intent, confidence: understood.understanding.confidence },
        state,
        results: verifiedResults,
        ui: buildNadimUi(toolResults, executedActions, { includeMediaLocation: /(?:اللوكيشن|الموقع|location|map)/iu.test(input.message) }),
        proposedActions,
        executedActions,
        metadata: {
          requestId,
          brainVersion: "v2",
          modelProvider: finalModel?.provider,
          model: finalModel?.model,
          fallbackUsed,
          understandingModelProvider: primaryModel?.provider,
          understandingModel: primaryModel?.model,
          understandingFallbackUsed: Boolean(primaryModel?.fallbackUsed),
          classificationSource: understood.understanding.classificationSource,
          understoodMeaning,
          responseGoal: understood.understanding.responseGoal,
          unknownReason: understood.understanding.unknownReason,
          recentContextUsed: Boolean(understood.understanding.recentContextUsed),
          toolDecision,
          toolNames: plan.steps.map((step) => step.tool),
          latencyMs,
          brainProvider: primaryModel?.provider,
          brainModel: primaryModel?.model,
          brainExecution: primaryModel ? (primaryModel.fallbackUsed ? "SECONDARY_AI" : "PRIMARY_AI") : "DETERMINISTIC_OUTAGE_FALLBACK",
          fallbackStage: primaryModel
            ? composed.providerErrorCategory ? "COMPOSE" : loop.providerErrorCategory ? "TOOL_LOOP" : primaryModel.fallbackUsed ? "UNDERSTAND" : "NONE"
            : "PROVIDER_OUTAGE",
          providerLatencyMs,
          databaseLatencyMs,
          toolLatencyMs,
          actionLatencyMs,
          compositionLatencyMs,
          providerErrorCategory,
          contextUsed: this.contextUsed(resolved),
          actionDecision: executedActions.length ? "EXECUTE" : proposedActions.length ? "PROPOSE" : "NO_ACTION",
          toolIterations: loop.iterations,
        },
      };

      if (control.deleteConfirmed && idempotencyKey && requestHash) {
        await this.conversations.deleteConfirmed({
          conversationId: resolved.conversation.id,
          channel: input.channel,
          idempotencyKey,
          requestHash,
          response,
        });
      } else {
        await this.conversations.persist({
          conversationId: resolved.conversation.id,
          state,
          requestId,
          channel: input.channel,
          userMessage: input.message,
          assistantReply: composed.reply,
          intent: understood.understanding,
          plan,
          toolResults,
          proposedActions,
          executedActions,
          modelProvider: finalModel?.provider,
          model: finalModel?.model,
          fallbackUsed,
          latencyMs,
          idempotencyKey,
          requestHash,
          claimedTurnId,
          response,
          customerContextUpdates: understood.understanding.customerContextUpdates,
        });
      }

      this.logger.log(`NadimV2Turn ${JSON.stringify({ requestId, conversationId: resolved.conversation.id, channel: input.channel, mode, brainProvider: primaryModel?.provider ?? "deterministic", brainModel: primaryModel?.model ?? null, brainExecution: response.metadata.brainExecution, providerErrorCategory: providerErrorCategory ?? null, fallbackStage: response.metadata.fallbackStage, understoodMeaning: understoodMeaning ?? null, responseGoal: understood.understanding.responseGoal ?? plan.goal, contextUsed: response.metadata.contextUsed, toolDecision, tools: plan.steps.map((step) => step.tool), toolIterations: loop.iterations, actionDecision: response.metadata.actionDecision, actions: executedActions.map((action) => ({ type: action.type, status: action.status, errorCode: action.errorCode })), success: true, latencyMs, providerLatencyMs, databaseLatencyMs, toolLatencyMs, actionLatencyMs, compositionLatencyMs })}`);
      return response;
    } catch (error) {
      if (claimedTurnId) await this.conversations.markIdempotentFailed(claimedTurnId).catch(() => undefined);
      throw error;
    }
  }

  private hasRequirementCriteria(state: { search: { locations: string[]; projects: string[]; developers: string[]; propertyTypes: string[]; bedrooms?: number; budgetMin?: number; budgetMax?: number } }) {
    const search = state.search;
    return Boolean(search.locations.length || search.projects.length || search.developers.length || search.propertyTypes.length || search.bedrooms != null || search.budgetMin != null || search.budgetMax != null);
  }

  private async normalizeBudget(state: any) {
    const amount = state.search.budgetMax;
    if (amount == null) return { ...state, search: { ...state.search, budget: undefined } };
    const currency = String(state.search.currency ?? "EGP").toUpperCase();
    const current = state.search.budget;
    if (current?.originalAmount === amount && current?.originalCurrency === currency) return state;
    if (currency === "EGP") {
      return { ...state, search: { ...state.search, currency, budget: { originalAmount: amount, originalCurrency: currency, normalizedAmount: amount, normalizedCurrency: "EGP", fxRate: 1, fxAsOf: new Date().toISOString(), fxSource: "IDENTITY", fxStatus: "VERIFIED" } } };
    }
    try {
      const budget = await this.fx?.normalize(amount, currency);
      if (!budget) throw Object.assign(new Error("FX unavailable"), { code: "FX_UNAVAILABLE" });
      return { ...state, search: { ...state.search, currency, budget } };
    } catch {
      return { ...state, search: { ...state.search, currency, budget: { originalAmount: amount, originalCurrency: currency, fxStatus: "UNAVAILABLE" } } };
    }
  }

  private async executeToolLoop(plan: { goal: string; steps: any[]; clarification?: string }, state: any, decision: any, trace: any): Promise<ToolLoopResult> {
    if (this.toolLoop) return this.toolLoop.run(plan, state, decision, trace);
    const results = await this.tools.execute(plan, state);
    return { results, iterations: plan.steps.length, finalDecision: decision, providerLatencyMs: 0 };
  }

  private async persistSuppressed(input: {
    input: NadimTurnDto;
    requestId: string;
    requestHash?: string;
    idempotencyKey?: string;
    claimedTurnId?: string;
    resolved: any;
    started: number;
    ownershipUnderstanding?: UnderstandingResult;
  }) {
    const latencyMs = Date.now() - input.started;
    const response: NadimTurnResult = {
      ok: true,
      version: "v2",
      replayed: false,
      conversationId: input.resolved.conversation.id,
      reply: "",
      suppressReply: true,
      mode: "HUMAN",
      intent: { type: "CONVERSATION", confidence: 1 },
      state: input.resolved.state,
      results: [],
      proposedActions: [],
      executedActions: [],
      metadata: {
        requestId: input.requestId,
        brainVersion: "v2",
        modelProvider: input.ownershipUnderstanding?.model?.provider,
        model: input.ownershipUnderstanding?.model?.model,
        fallbackUsed: Boolean(input.ownershipUnderstanding?.model?.fallbackUsed),
        understandingModelProvider: input.ownershipUnderstanding?.model?.provider,
        understandingModel: input.ownershipUnderstanding?.model?.model,
        understandingFallbackUsed: Boolean(input.ownershipUnderstanding?.model?.fallbackUsed),
        classificationSource: input.ownershipUnderstanding?.understanding.classificationSource,
        understoodMeaning: safeDiagnosticMeaning(input.ownershipUnderstanding?.understanding.understoodMeaning),
        responseGoal: "SUPPRESS_AI_REPLY_WHILE_HUMAN_OWNS_CONVERSATION",
        recentContextUsed: Boolean(input.ownershipUnderstanding?.understanding.recentContextUsed),
        toolDecision: "NO_TOOL",
        toolNames: [],
        latencyMs,
        brainProvider: input.ownershipUnderstanding?.model?.provider,
        brainModel: input.ownershipUnderstanding?.model?.model,
        brainExecution: "DETERMINISTIC_POLICY",
        fallbackStage: "NONE",
        providerLatencyMs: input.ownershipUnderstanding?.providerLatencyMs ?? 0,
        providerErrorCategory: input.ownershipUnderstanding?.providerErrorCategory,
        contextUsed: ["OWNERSHIP_MODE"],
        actionDecision: "SUPPRESS",
        toolIterations: 0,
      },
    };
    await this.conversations.persist({
      conversationId: input.resolved.conversation.id,
      state: input.resolved.state,
      requestId: input.requestId,
      channel: input.input.channel,
      userMessage: input.input.message,
      assistantReply: "",
      intent: { type: "HUMAN_OWNED_INBOUND" },
      plan: { goal: "SUPPRESS_AI_REPLY", steps: [] },
      toolResults: [],
      proposedActions: [],
      executedActions: [],
      fallbackUsed: false,
      latencyMs,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      claimedTurnId: input.claimedTurnId,
      response,
    });
    return response;
  }

  private contextUsed(resolved: any) {
    return [
      resolved.conversationContext?.recentTurns?.length ? "RECENT_TURNS" : undefined,
      resolved.conversationContext?.summary ? "SUMMARY" : undefined,
      resolved.conversationContext?.customerContext ? "CUSTOMER_CONTEXT" : undefined,
      resolved.state?.lastResultIds?.length ? "RECENT_RESULTS" : undefined,
      resolved.state?.selectedUnitId || resolved.state?.selectedProjectId ? "SELECTED_RESULT" : undefined,
      resolved.conversationContext?.pendingDeletion ? "PENDING_ACTION" : undefined,
      "ACTIVE_STATE",
      "OWNERSHIP_MODE",
    ].filter(Boolean) as string[];
  }
}
