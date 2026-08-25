import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { NadimTurnDto } from "../dto/nadim-turn.dto";
import { NadimTurnResult } from "../domain/nadim-result";
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
    return existing ? this.replay(existing, requestHash) : null;
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
    const [explicitCustomer, channelIdentity] = await Promise.all([
      input.customerId ? this.prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } }) : null,
      input.externalUserId && input.channel !== "N8N" ? this.prisma.customerChannelIdentity.findUnique({ where: { channel_externalId: { channel: input.channel, externalId: input.externalUserId } }, select: { customerId: true } }) : null,
    ]);
    if (input.customerId && !explicitCustomer) throw new NotFoundException({ code: "NADIM_CUSTOMER_NOT_FOUND", message: "Customer not found", safe: true });
    if (explicitCustomer && channelIdentity && explicitCustomer.id !== channelIdentity.customerId) {
      throw new ConflictException({ code: "NADIM_CUSTOMER_IDENTITY_CONFLICT", message: "Customer and channel identity conflict", safe: true });
    }
    const resolvedCustomerId = explicitCustomer?.id ?? channelIdentity?.customerId;
    let conversation = input.conversationId
      ? await this.prisma.nadimConversation.findUnique({ where: { id: input.conversationId } })
      : resolvedCustomerId
        ? await this.prisma.nadimConversation.findFirst({ where: { customerId: resolvedCustomerId }, orderBy: { updatedAt: "desc" } })
        : input.externalUserId
          ? await this.prisma.nadimConversation.findFirst({ where: { channel: input.channel, externalUserId: input.externalUserId }, orderBy: { updatedAt: "desc" } })
          : null;
    if (input.conversationId && !conversation) throw new NotFoundException({ code: "NADIM_CONVERSATION_NOT_FOUND", message: "Nadim conversation not found", safe: true });
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
        state: json(state),
      } });
    }
    if (customerId && input.externalUserId && input.channel !== "N8N" && !channelIdentity) {
      await this.prisma.customerChannelIdentity.create({ data: {
        customerId,
        channel: input.channel,
        externalId: input.externalUserId,
        metadata: { source: "NADIM_V2" },
      } });
    }
    const state = validState(conversation.state)
      ? conversation.state
      : initialNadimState({ channel: input.channel, customerId, externalUserId: input.externalUserId, locale: input.locale });
    return { conversation, state, customerId };
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
    return this.prisma.$transaction([
      this.prisma.nadimConversation.update({
        where: { id: input.conversationId },
        data: {
          state: json(input.state),
          channel: input.channel,
          customerId: input.state.customerId,
          externalUserId: input.state.externalUserId,
          locale: input.state.locale,
        },
      }),
      input.claimedTurnId
        ? this.prisma.nadimTurn.update({ where: { id: input.claimedTurnId }, data: turnData })
        : this.prisma.nadimTurn.create({ data: { conversationId: input.conversationId, ...turnData } }),
    ]);
  }

  private replay(existing: { requestHash: string | null; responsePayload: Prisma.JsonValue | null; errorCode: string | null }, requestHash: string): NadimTurnResult {
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
