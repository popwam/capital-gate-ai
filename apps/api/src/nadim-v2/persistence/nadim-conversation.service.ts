import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { NadimTurnDto } from "../dto/nadim-turn.dto";
import { conversationStage, NadimConversationContext, NadimRecentToolSummary, NadimRecentTurnContext } from "../domain/nadim-conversation-context";
import { CURRENT_SEARCH_QUERY_TARGETS, NADIM_INTENTS, NadimIntentType } from "../domain/nadim-intent";
import { NadimTurnResult } from "../domain/nadim-result";
import { NadimConversationMode } from "../domain/nadim-action";

function localeTimezone(locale?: string | null) {
  const region = locale?.match(/[-_]([A-Za-z]{2})\b/u)?.[1]?.toUpperCase();
  return ({ EG: "Africa/Cairo", SA: "Asia/Riyadh", AE: "Asia/Dubai", KW: "Asia/Kuwait", QA: "Asia/Qatar", BH: "Asia/Bahrain", OM: "Asia/Muscat" } as Record<string, string>)[region ?? ""];
}
import { initialNadimState, NadimState } from "../domain/nadim-state";

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function validState(value: unknown): value is NadimState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<NadimState>;
  return state.version === 2 && typeof state.revision === "number" && Boolean(state.search) && Array.isArray(state.lastResultIds);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function objectValue(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : undefined;
}

function plainObject(value: Prisma.JsonValue | null | undefined): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function toolSummary(value: Prisma.JsonValue): NadimRecentToolSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = objectValue(item);
    if (!record || typeof record.tool !== "string" || typeof record.ok !== "boolean") return [];
    const count = Array.isArray(record.data) ? record.data.length : record.data == null ? 0 : 1;
    return [{
      tool: record.tool.slice(0, 80),
      ok: record.ok,
      resultCount: count,
      errorCode: typeof record.errorCode === "string" ? record.errorCode.slice(0, 100) : undefined,
    }];
  }).slice(0, 10);
}

function recentTurnContext(row: {
  userMessage: string;
  assistantReply: string;
  intent: Prisma.JsonValue;
  plan: Prisma.JsonValue;
  toolResults: Prisma.JsonValue;
}): NadimRecentTurnContext {
  const intent = objectValue(row.intent);
  const plan = objectValue(row.plan);
  const intentValue = typeof intent?.intent === "string" && (NADIM_INTENTS as readonly string[]).includes(intent.intent)
    ? intent.intent as NadimIntentType
    : undefined;
  const stateQuery = typeof intent?.stateQuery === "string" && (CURRENT_SEARCH_QUERY_TARGETS as readonly string[]).includes(intent.stateQuery)
    ? intent.stateQuery as NadimRecentTurnContext["stateQuery"]
    : undefined;
  return {
    user: row.userMessage.slice(0, 500),
    assistant: row.assistantReply.slice(0, 1_000),
    intent: intentValue,
    stateQuery,
    responseGoal: typeof intent?.responseGoal === "string"
      ? intent.responseGoal.slice(0, 120)
      : typeof plan?.goal === "string" ? plan.goal.slice(0, 120) : undefined,
    tools: toolSummary(row.toolResults),
  };
}

export function nadimTurnRequestHash(input: NadimTurnDto) {
  return createHash("sha256").update(canonical(input), "utf8").digest("hex");
}

@Injectable()
export class NadimConversationService {
  constructor(private readonly prisma: PrismaService) {}

  async replayIdempotent(channel: string, idempotencyKey: string, requestHash: string) {
    const existing = await this.prisma.nadimTurn.findUnique({
      where: { channel_idempotencyKey: { channel, idempotencyKey } },
    });
    if (existing) return this.replay(existing, requestHash);
    const deletion = await this.prisma.nadimDeletionReceipt.findUnique({
      where: { channel_idempotencyKey: { channel, idempotencyKey } },
    });
    if (deletion) return this.replay(deletion, requestHash);
    return null;
  }

  async claimIdempotent(input: {
    conversationId: string;
    channel: string;
    idempotencyKey: string;
    requestHash: string;
    requestId?: string;
    userMessage: string;
  }): Promise<{ turnId?: string; replay?: NadimTurnResult }> {
    try {
      const turn = await this.prisma.nadimTurn.create({ data: {
        conversationId: input.conversationId,
        requestId: input.requestId,
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        userMessage: input.userMessage,
        assistantReply: "",
        intent: {},
        plan: {},
        toolResults: [],
        proposedActions: [],
        executedActions: [],
        success: false,
        latencyMs: 0,
        errorCode: "IDEMPOTENCY_IN_PROGRESS",
      } });
      return { turnId: turn.id };
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error;
      const replay = await this.replayIdempotent(input.channel, input.idempotencyKey, input.requestHash);
      if (!replay) throw error;
      return { replay };
    }
  }

  markIdempotentFailed(turnId: string, errorCode = "TURN_PROCESSING_FAILED") {
    return this.prisma.nadimTurn.update({
      where: { id: turnId },
      data: { success: false, errorCode },
    });
  }

  async resolve(input: NadimTurnDto) {
    const [explicitCustomer, channelIdentity, participant] = await Promise.all([
      input.customerId ? this.prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }) : null,
      input.externalUserId && input.channel !== "N8N" ? this.prisma.customerChannelIdentity.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalUserId } }, select: { customerId: true } }) : null,
      input.externalUserId && input.channel !== "N8N" ? this.prisma.conversationParticipant.findFirst({ where: { channel: input.channel, externalUserId: input.externalUserId, status: "ACTIVE", conversation: { deletedAt: null } }, orderBy: { joinedAt: "desc" }, select: { conversationId: true, customerId: true } }) : null,
    ]);
    if (input.customerId && !explicitCustomer) throw new NotFoundException({ code: "NADIM_CUSTOMER_NOT_FOUND", message: "Customer not found", safe: true });
    if (explicitCustomer && channelIdentity && explicitCustomer.id !== channelIdentity.customerId) {
      throw new ConflictException({ code: "NADIM_CUSTOMER_IDENTITY_CONFLICT", message: "Customer and channel identity conflict", safe: true });
    }
    const resolvedCustomerId = explicitCustomer?.id ?? channelIdentity?.customerId ?? participant?.customerId ?? undefined;
    const supportsLifecycleFilter = typeof this.prisma.nadimConversation.findFirst === "function";
    let conversation = input.conversationId
      ? supportsLifecycleFilter
        ? await this.prisma.nadimConversation.findFirst({ where: { id: input.conversationId, deletedAt: null } })
        : await this.prisma.nadimConversation.findUnique({ where: { id: input.conversationId } })
      : participant
        ? await this.prisma.nadimConversation.findFirst({ where: { id: participant.conversationId, deletedAt: null } })
      : resolvedCustomerId
        ? await this.prisma.nadimConversation.findFirst({ where: { customerId: resolvedCustomerId, deletedAt: null }, orderBy: { updatedAt: "desc" } })
        : input.externalUserId
          ? await this.prisma.nadimConversation.findFirst({ where: { channel: input.channel, externalUserId: input.externalUserId, deletedAt: null }, orderBy: { updatedAt: "desc" } })
          : null;
    if (input.conversationId && !conversation) throw new NotFoundException({ code: "NADIM_CONVERSATION_NOT_FOUND", message: "Nadim conversation not found", safe: true });
    if (input.conversationId && input.externalUserId && participant?.conversationId !== conversation?.id && conversation?.externalUserId !== input.externalUserId) {
      throw new ConflictException({ code: "NADIM_CONVERSATION_PARTICIPANT_CONFLICT", message: "The channel identity is not authorized for this conversation", safe: true });
    }
    if (conversation?.customerId && resolvedCustomerId && conversation.customerId !== resolvedCustomerId) {
      throw new ConflictException({ code: "NADIM_CONVERSATION_CUSTOMER_CONFLICT", message: "Conversation belongs to a different customer", safe: true });
    }
    const customerId = resolvedCustomerId ?? conversation?.customerId ?? undefined;
    if (!conversation) {
      const state = initialNadimState({ channel: input.channel, customerId, externalUserId: input.externalUserId, locale: input.locale });
      conversation = await this.prisma.nadimConversation.create({ data: {
        customerId,
        channel: input.channel,
        externalUserId: input.externalUserId,
        locale: input.locale ?? state.locale,
        timezone: localeTimezone(input.locale ?? state.locale),
        state: json(state),
      } });
    }
    if (!conversation.timezone) {
      const timezone = localeTimezone(input.locale ?? conversation.locale);
      if (timezone) conversation = await this.prisma.nadimConversation.update({ where: { id: conversation.id }, data: { timezone } });
    }
    if (customerId && input.externalUserId && input.channel !== "N8N" && !channelIdentity && !participant) {
      await this.prisma.customerChannelIdentity.create({ data: {
        customerId,
        channel: input.channel,
        externalId: input.externalUserId,
        metadata: { source: "NADIM_V2" },
      } });
    }
    if (input.externalUserId && input.channel !== "N8N") {
      await this.prisma.conversationParticipant.upsert({
        where: { conversationId_channel_externalUserId: { conversationId: conversation.id, channel: input.channel, externalUserId: input.externalUserId } },
        create: { conversationId: conversation.id, channel: input.channel, externalUserId: input.externalUserId, customerId, role: participant ? "MEMBER" : "OWNER", status: "ACTIVE" },
        update: { status: "ACTIVE", leftAt: null },
      });
    }
    const state = validState(conversation.state)
      ? conversation.state
      : initialNadimState({ channel: input.channel, customerId, externalUserId: input.externalUserId, locale: input.locale });
    const recentRows = await this.prisma.nadimTurn.findMany({
      where: { conversationId: conversation.id, success: true },
      orderBy: { createdAt: "desc" },
      take: 12,
      select: { userMessage: true, assistantReply: true, intent: true, plan: true, toolResults: true },
    });
    const requirements = customerId && typeof this.prisma.propertyRequirement?.findMany === "function"
      ? await this.prisma.propertyRequirement.findMany({
          where: { customerId, conversationId: conversation.id, status: { not: "CLOSED" } },
          orderBy: { createdAt: "asc" },
          take: 10,
          select: { id: true, title: true, purpose: true, propertyType: true, locations: true, preferredDevelopers: true, preferredProjects: true, bedrooms: true, bathrooms: true, areaMin: true, areaMax: true, budgetMin: true, budgetMax: true, currency: true, budgetOriginalAmount: true, budgetOriginalCurrency: true, budgetNormalizedAmount: true, budgetNormalizedCurrency: true, fxRate: true, fxAsOf: true, fxSource: true, paymentPreference: true, deliveryPreference: true, recentResultIds: true, selectedUnitId: true, selectedProjectId: true, comparisonUnitIds: true, status: true, createdAt: true, updatedAt: true },
        })
      : [];
    const customerProfile = customerId && typeof this.prisma.customer?.findUnique === "function"
      ? await this.prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, normalizedPhone: true, normalizedEmail: true } })
      : null;
    const recentTurns = recentRows.reverse().map(recentTurnContext);
    const last = recentTurns.at(-1);
    const lastVerifiedToolSummary = [...recentTurns].reverse().find((turn) => turn.tools.some((tool) => tool.ok))?.tools;
    const conversationContext: NadimConversationContext = {
      mode: conversation.mode as NadimConversationMode,
      stage: conversationStage(state),
      recentTurns,
      lastVerifiedToolSummary,
      summary: plainObject(conversation.summary),
      customerContext: {
        ...plainObject(conversation.customerContext),
        customerProfile,
        activeRequirementId: conversation.activeRequirementId ?? null,
        propertyRequirements: requirements.map((requirement) => ({
          ...requirement,
          budgetMin: requirement.budgetMin == null ? null : Number(requirement.budgetMin),
          budgetMax: requirement.budgetMax == null ? null : Number(requirement.budgetMax),
          budgetOriginalAmount: requirement.budgetOriginalAmount == null ? null : Number(requirement.budgetOriginalAmount),
          budgetNormalizedAmount: requirement.budgetNormalizedAmount == null ? null : Number(requirement.budgetNormalizedAmount),
          fxRate: requirement.fxRate == null ? null : Number(requirement.fxRate),
          areaMin: requirement.areaMin == null ? null : Number(requirement.areaMin),
          areaMax: requirement.areaMax == null ? null : Number(requirement.areaMax),
        })),
      },
      pendingDeletion: plainObject(conversation.pendingDeletion) as NadimConversationContext["pendingDeletion"],
    };
    return {
      conversation,
      state,
      customerId,
      previousTurn: last ? { userMessage: last.user, assistantReply: last.assistant } : undefined,
      conversationContext,
      mode: conversation.mode as NadimConversationMode,
    };
  }

  async setMode(conversationId: string, mode: NadimConversationMode) {
    const now = new Date();
    return this.prisma.nadimConversation.update({
      where: { id: conversationId },
      data: {
        mode,
        modeChangedAt: now,
        humanModeSince: mode === "HUMAN" ? now : null,
        lastHumanMessageAt: null,
      },
    });
  }

  async requestDeletion(conversationId: string, now = new Date()) {
    const pending = {
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    };
    await this.prisma.nadimConversation.update({ where: { id: conversationId }, data: { pendingDeletion: json(pending) } });
    return pending;
  }

  async clearDeletionRequest(conversationId: string) {
    await this.prisma.nadimConversation.update({ where: { id: conversationId }, data: { pendingDeletion: Prisma.DbNull } });
  }

  async deleteConfirmed(input: {
    conversationId: string;
    channel: string;
    idempotencyKey: string;
    requestHash: string;
    response: NadimTurnResult;
  }) {
    await this.prisma.$transaction(async (transaction) => {
      const conversation = await transaction.nadimConversation.findUnique({
        where: { id: input.conversationId },
        select: { id: true, webConversations: { select: { id: true } } },
      });
      if (!conversation) return;
      await transaction.nadimDeletionReceipt.create({ data: {
        channel: input.channel,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        conversationId: input.conversationId,
        responsePayload: json(input.response),
      } });
      if (conversation.webConversations.length) {
        await transaction.conversation.deleteMany({ where: { nadimConversationId: conversation.id } });
      }
      await transaction.nadimConversation.delete({ where: { id: conversation.id } });
    });
  }

  persist(input: {
    conversationId: string;
    state: NadimState;
    requestId?: string;
    channel: string;
    userMessage: string;
    assistantReply: string;
    intent: unknown;
    plan: unknown;
    toolResults: unknown;
    proposedActions: unknown;
    executedActions: unknown;
    modelProvider?: string;
    model?: string;
    fallbackUsed: boolean;
    latencyMs: number;
    idempotencyKey?: string;
    requestHash?: string;
    claimedTurnId?: string;
    response: NadimTurnResult;
    customerContextUpdates?: Record<string, string | number | boolean | null>;
  }) {
    const turnData = {
      requestId: input.requestId,
      channel: input.channel,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      responsePayload: json(input.response),
      userMessage: input.userMessage,
      assistantReply: input.assistantReply,
      intent: json(input.intent),
      plan: json(input.plan),
      toolResults: json(input.toolResults),
      proposedActions: json(input.proposedActions),
      executedActions: json(input.executedActions),
      modelProvider: input.modelProvider,
      model: input.model,
      fallbackUsed: input.fallbackUsed,
      success: true,
      latencyMs: input.latencyMs,
      errorCode: null,
    };
    const currentCustomerContext = input.customerContextUpdates && Object.keys(input.customerContextUpdates).length
      ? this.prisma.nadimConversation.findUnique({ where: { id: input.conversationId }, select: { customerContext: true } })
      : Promise.resolve(null);
    return currentCustomerContext.then((current) => this.prisma.$transaction([
      this.prisma.nadimConversation.update({
        where: { id: input.conversationId },
        data: {
          state: json(input.state),
          channel: input.channel,
          customerId: input.state.customerId,
          // Channel identities belong to ConversationParticipant. Preserve this
          // legacy resolver field instead of replacing it when another invited
          // participant sends a turn.
          locale: input.state.locale,
          customerContext: input.customerContextUpdates && Object.keys(input.customerContextUpdates).length
            ? json({ ...plainObject(current?.customerContext), ...input.customerContextUpdates })
            : undefined,
          summary: json({
            activeSearch: input.state.search,
            selectedUnitId: input.state.selectedUnitId ?? null,
            selectedProjectId: input.state.selectedProjectId ?? null,
            lastUnderstoodMeaning: typeof (input.intent as { understoodMeaning?: unknown })?.understoodMeaning === "string"
              ? (input.intent as { understoodMeaning: string }).understoodMeaning.slice(0, 500)
              : null,
            responseGoal: typeof (input.intent as { responseGoal?: unknown })?.responseGoal === "string"
              ? (input.intent as { responseGoal: string }).responseGoal.slice(0, 220)
              : null,
          }),
        },
      }),
      input.claimedTurnId
        ? this.prisma.nadimTurn.update({ where: { id: input.claimedTurnId }, data: turnData })
        : this.prisma.nadimTurn.create({ data: { conversationId: input.conversationId, ...turnData } }),
    ]));
  }

  private replay(existing: { requestHash: string | null; responsePayload: Prisma.JsonValue | null; errorCode?: string | null }, requestHash: string): NadimTurnResult {
    if (existing.requestHash !== requestHash) {
      throw new ConflictException({ code: "IDEMPOTENCY_CONFLICT", message: "The idempotency key was already used for a different request", safe: true });
    }
    if (existing.responsePayload) {
      return { ...(existing.responsePayload as unknown as NadimTurnResult), replayed: true };
    }
    const inProgress = existing.errorCode === "IDEMPOTENCY_IN_PROGRESS";
    throw new ConflictException({
      code: inProgress ? "TURN_IN_PROGRESS" : "IDEMPOTENT_TURN_FAILED",
      message: inProgress ? "An identical turn with this idempotency key is still in progress" : "The prior turn with this idempotency key did not complete",
      safe: true,
    });
  }
}
