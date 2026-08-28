import { Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { ActionPolicyService } from "./brain/action-policy.service";
import { PlannerService } from "./brain/planner.service";
import { ResponseComposerService } from "./brain/response-composer.service";
import { StateEngineService } from "./brain/state-engine.service";
import { ToolExecutorService } from "./brain/tool-executor.service";
import { UnderstandingService } from "./brain/understanding.service";
import { NadimTurnResult } from "./domain/nadim-result";
import { NadimTurnDto } from "./dto/nadim-turn.dto";
import { LanguageStyleDetectorService } from "./personality/language-style-detector.service";
import { nadimTurnRequestHash, NadimConversationService } from "./persistence/nadim-conversation.service";

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
    const resolved = await this.conversations.resolve(input);
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
    const styledPrevious = this.languageStyles.apply(resolved.state, input.message, input.locale);
    const understood = await this.understanding.understand(input.message, styledPrevious, trace, resolved.conversationContext);
    let state = this.stateEngine.apply(styledPrevious, understood.understanding, {
      channel: input.channel,
      customerId: resolved.customerId,
      externalUserId: input.externalUserId,
      locale: input.locale,
    });
    const plan = this.planner.plan(understood.understanding, state);
    const toolResults = await this.tools.execute(plan, state);
    const verifiedResults = toolResults.filter((result) => result.ok).flatMap((result) => Array.isArray(result.data) ? result.data : result.data == null ? [] : [result.data]) as any[];
    if (plan.goal === "PROPERTY_SEARCH") state = this.stateEngine.withResults(state, verifiedResults.map((item) => item?.id).filter(Boolean));
    if (!state.selectedUnitId && understood.understanding.unitReference && verifiedResults[0]?.id) state = { ...state, selectedUnitId: verifiedResults[0].id };
    const proposedActions = this.actionPolicy.propose(understood.understanding, state);
    const executedActions = await this.actionPolicy.execute(proposedActions, {
      channel: input.channel,
      customerId: state.customerId,
      externalUserId: input.externalUserId,
      conversationId: resolved.conversation.id,
      requestId: idempotencyKey && requestHash
        ? `nadim-${createHash("sha256").update(`${input.channel}:${idempotencyKey}:${requestHash}`, "utf8").digest("hex")}`
        : requestId,
    });
    const composed = await this.composer.compose({
      userMessage: input.message,
      understanding: understood.understanding,
      state,
      plan,
      toolResults,
      proposedActions,
      executedActions,
      previousTurn: resolved.previousTurn,
      conversationContext: resolved.conversationContext,
      trace,
    });
    state = this.stateEngine.withAssistantWording(state, composed.reply);
    const model = composed.model ?? understood.model;
    const fallbackUsed = Boolean(understood.model?.fallbackUsed || composed.model?.fallbackUsed);
    const latencyMs = Date.now() - started;
    const response: NadimTurnResult = {
      ok: true,
      version: "v2",
      replayed: false,
      conversationId: resolved.conversation.id,
      reply: composed.reply,
      intent: { type: understood.understanding.intent, confidence: understood.understanding.confidence },
      state,
      results: verifiedResults,
      proposedActions,
      executedActions,
      metadata: {
        requestId,
        brainVersion: "v2",
        modelProvider: model?.provider,
        model: model?.model,
        fallbackUsed,
        toolNames: plan.steps.map((step) => step.tool),
        latencyMs,
      },
    };
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
      modelProvider: model?.provider,
      model: model?.model,
      fallbackUsed,
      latencyMs,
      idempotencyKey,
      requestHash,
      claimedTurnId,
      response,
    });
    this.logger.log(`NadimV2Turn ${JSON.stringify({ requestId, conversationId: resolved.conversation.id, customerId: state.customerId ?? null, channel: input.channel, brainVersion: "v2", intent: understood.understanding.intent, responseGoal: understood.understanding.responseGoal ?? plan.goal, referenceResolution: (understood.understanding.references ?? []).map((reference) => ({ resolvedAs: reference.resolvedAs, confidence: reference.confidence })), recentContextUsed: understood.understanding.recentContextUsed ?? false, conversationStage: resolved.conversationContext?.stage ?? null, languageStyle: state.languageStyle.preferredResponseStyle, toolDecision: plan.steps.length ? "EXECUTE" : plan.clarification ? "CLARIFY" : "NO_TOOL", tools: plan.steps.map((step) => step.tool), modelProvider: model?.provider ?? "deterministic", model: model?.model ?? null, fallbackUsed, modelLatencyMs: (understood.model?.latencyMs ?? 0) + (composed.model?.latencyMs ?? 0), toolLatencyMs: toolResults.reduce((sum, result) => sum + result.latencyMs, 0), proposedActions: proposedActions.map((action) => action.type), actionResults: executedActions.map((action) => ({ type: action.type, status: action.status, errorCode: action.errorCode })), success: true, latencyMs })}`);
    return response;
    } catch (error) {
      if (claimedTurnId) {
        await this.conversations.markIdempotentFailed(claimedTurnId).catch(() => undefined);
      }
      throw error;
    }
  }
}
