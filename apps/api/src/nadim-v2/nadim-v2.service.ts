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
import { ExecutedAction, NadimConversationMode } from "./domain/nadim-action";
import { NadimTurnResult } from "./domain/nadim-result";
import { NadimTurnDto } from "./dto/nadim-turn.dto";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { nadimTurnRequestHash, NadimConversationService } from "./persistence/nadim-conversation.service";
import { CustomerLifecycleService } from "./product/customer-lifecycle.service";

function safeDiagnosticMeaning(value?: string) {
  if (!value) return undefined;
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/gu, "[phone]")
    .replace(/\b[\w-]{32,}\b/gu, "[identifier]")
    .slice(0, 240);
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

    const resolved = await this.conversations.resolve(input);
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
      const styledPrevious = understood.brainDecision
        ? this.languageStyles.applySemanticRequest(brainInputState, understood.understanding.responseStyleRequest ?? undefined)
        : detectedState;
      let state = this.stateEngine.apply(styledPrevious, understood.understanding, {
        channel: input.channel,
        customerId: resolved.customerId,
        externalUserId: input.externalUserId,
        locale: input.locale,
      });

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

      const plan = control.action
        ? { goal: control.action, steps: [] }
        : this.planner.plan(understood.understanding, state);
      const loop = await this.executeToolLoop(plan, state, understood.brainDecision, trace);
      const toolResults = loop.results;
      const finalDecision = loop.finalDecision;
      if (finalDecision) {
        understood.understanding.responseGoal = finalDecision.conversationalGoal;
        understood.understanding.responsePlan = finalDecision.responsePlan;
        understood.understanding.proposedActions = finalDecision.proposedActions;
      }

      const verifiedResults = toolResults
        .filter((result) => result.ok)
        .flatMap((result) => Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data]) as any[];
      const propertySearchResult = toolResults.find((result) => result.tool === "PROPERTY_SEARCH" && result.ok);
      if (propertySearchResult) {
        const searchRows = Array.isArray(propertySearchResult.data) ? propertySearchResult.data : [];
        state = this.stateEngine.withResults(state, searchRows.map((item: any) => item?.id).filter(Boolean));
        if (this.lifecycle && this.hasRequirementCriteria(state)) {
          await this.lifecycle.saveRequirement({
            conversationId: resolved.conversation.id,
            channel: input.channel,
            externalUserId: input.externalUserId,
            state,
            status: searchRows.length ? "MATCHED" : "NEEDS_MATCH",
            allowNew: understood.understanding.intent === "PROPERTY_SEARCH",
          });
        }
      }
      const unitFacts = toolResults.find((result) => result.tool === "GET_UNIT_FACTS" && result.ok)?.data as { id?: string } | undefined;
      if (!state.selectedUnitId && understood.understanding.unitReference && unitFacts?.id) {
        state = { ...state, selectedUnitId: unitFacts.id };
      }

      const proposedActions = control.action ? [] : this.actionPolicy.propose(understood.understanding, state);
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
      const executedActions: ExecutedAction[] = [...(control.executed ? [control.executed] : []), ...externalActions];

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
      });
      state = this.stateEngine.withAssistantWording(state, composed.reply);

      const primaryModel = understood.model;
      const finalModel = composed.model ?? loop.model ?? primaryModel;
      const fallbackUsed = Boolean(primaryModel?.fallbackUsed || loop.model?.fallbackUsed || composed.model?.fallbackUsed || !primaryModel);
      const providerLatencyMs = (understood.providerLatencyMs ?? 0) + loop.providerLatencyMs + (composed.providerLatencyMs ?? 0);
      const providerErrorCategory = composed.providerErrorCategory ?? loop.providerErrorCategory ?? understood.providerErrorCategory;
      const understoodMeaning = safeDiagnosticMeaning(understood.understanding.understoodMeaning);
      const toolDecision = plan.steps.length ? "EXECUTE" as const : plan.clarification ? "CLARIFY" as const : "NO_TOOL" as const;
      const latencyMs = Date.now() - started;
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

      this.logger.log(`NadimV2Turn ${JSON.stringify({ requestId, conversationId: resolved.conversation.id, channel: input.channel, mode, brainProvider: primaryModel?.provider ?? "deterministic", brainModel: primaryModel?.model ?? null, brainExecution: response.metadata.brainExecution, providerErrorCategory: providerErrorCategory ?? null, fallbackStage: response.metadata.fallbackStage, understoodMeaning: understoodMeaning ?? null, responseGoal: understood.understanding.responseGoal ?? plan.goal, contextUsed: response.metadata.contextUsed, toolDecision, tools: plan.steps.map((step) => step.tool), toolIterations: loop.iterations, actionDecision: response.metadata.actionDecision, actions: executedActions.map((action) => ({ type: action.type, status: action.status, errorCode: action.errorCode })), success: true, latencyMs })}`);
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
