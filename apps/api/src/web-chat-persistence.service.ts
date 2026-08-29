import { ConflictException, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { ConversationsService } from "./conversations.service";
import { CustomerLifecycleService } from "./nadim-v2/product/customer-lifecycle.service";

type PersistNadimWebTurn = {
  legacyConversationId: string;
  nadimConversationId: string;
  deviceToken: string;
  eventId: string;
  userMessage: string;
  assistantReply?: string;
  suppressReply?: boolean;
  resultMetadata?: Record<string, unknown>;
};

const messageId = (eventId: string, role: "user" | "assistant") =>
  `nadim_${createHash("sha256").update(`WEB:${eventId}:${role}`).digest("hex")}`;

@Injectable()
export class WebChatPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    @Optional() private readonly lifecycle?: CustomerLifecycleService,
  ) {}

  async persist(input: PersistNadimWebTurn) {
    const { conversation } = await this.conversations.assertOwned(input.legacyConversationId, input.deviceToken);
    if (conversation.nadimConversationId && conversation.nadimConversationId !== input.nadimConversationId) {
      throw new ConflictException({ code: "WEB_NADIM_CONVERSATION_CONFLICT", message: "The web conversation is already linked to a different Nadim conversation", safe: true });
    }

    const userId = messageId(input.eventId, "user");
    const assistantId = messageId(input.eventId, "assistant");
    const messages: Prisma.MessageCreateManyInput[] = [
      { id: userId, conversationId: conversation.id, role: "USER", content: input.userMessage },
    ];
    if (!input.suppressReply && input.assistantReply) messages.push({
      id: assistantId,
      conversationId: conversation.id,
      role: "ASSISTANT",
      content: input.assistantReply,
      toolPayload: JSON.parse(JSON.stringify({
        type: "nadim_v2",
        brainVersion: "v2",
        nadimConversationId: input.nadimConversationId,
        eventId: input.eventId,
        ...(input.resultMetadata ? { metadata: input.resultMetadata } : {}),
      })) as Prisma.InputJsonValue,
    });
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { nadimConversationId: input.nadimConversationId },
      }),
      this.prisma.message.createMany({
        data: messages,
        skipDuplicates: true,
      }),
    ]);

    if (input.suppressReply) return this.prisma.message.findUniqueOrThrow({ where: { id: userId } });
    return this.prisma.message.findUniqueOrThrow({ where: { id: assistantId } });
  }

  async conversationAction(input: { legacyConversationId: string; deviceToken: string; action: "SHARE" | "WHATSAPP" }) {
    if (!this.lifecycle) throw new ConflictException({ code: "PRODUCT_LAYER_UNAVAILABLE", message: "Conversation actions are unavailable", safe: true });
    const { conversation } = await this.conversations.assertOwned(input.legacyConversationId, input.deviceToken);
    if (!conversation.nadimConversationId) throw new ConflictException({ code: "NADIM_CONVERSATION_NOT_LINKED", message: "Send a message before sharing this conversation", safe: true });
    if (input.action === "SHARE") {
      const base = process.env.WEB_BASE_URL?.trim()?.replace(/\/$/u, "");
      if (!base) throw new ConflictException({ code: "WEB_BASE_URL_REQUIRED", message: "Conversation sharing is not configured", safe: true });
      const created = await this.lifecycle.createToken({ conversationId: conversation.nadimConversationId, type: "WEB_SHARE" });
      return { tokenId: created.id, url: `${base}/c/${encodeURIComponent(created.token)}`, expiresAt: created.expiresAt };
    }
    const number = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/gu, "");
    if (!number) throw new ConflictException({ code: "WHATSAPP_BUSINESS_NUMBER_REQUIRED", message: "WhatsApp continuation is not configured", safe: true });
    const created = await this.lifecycle.createToken({ conversationId: conversation.nadimConversationId, type: "WHATSAPP_HANDOFF", maxUses: 1 });
    return { tokenId: created.id, url: `https://wa.me/${number}?text=${encodeURIComponent(`continue ${created.token}`)}`, expiresAt: created.expiresAt };
  }

  async joinSharedConversation(input: { token: string; deviceToken: string }) {
    if (!this.lifecycle) throw new ConflictException({ code: "PRODUCT_LAYER_UNAVAILABLE", message: "Conversation sharing is unavailable", safe: true });
    await this.lifecycle.validateToken(input.token, "WEB_SHARE");
    const legacy = await this.conversations.create(input.deviceToken, "Shared Nadim conversation");
    const externalUserId = `web:${createHash("sha256").update(`${input.deviceToken}:${legacy.id}`).digest("hex")}`;
    try {
      const joined = await this.lifecycle.consumeToken({ token: input.token, expectedType: "WEB_SHARE", channel: "WEB", externalUserId });
      const turns = await this.prisma.nadimTurn.findMany({
        where: { conversationId: joined.conversationId, success: true }, orderBy: { createdAt: "asc" }, take: 200,
        select: { id: true, userMessage: true, assistantReply: true, createdAt: true },
      });
      const messages: Prisma.MessageCreateManyInput[] = turns.flatMap((turn) => [
        { id: `share_${createHash("sha256").update(`${legacy.id}:${turn.id}:user`).digest("hex")}`, conversationId: legacy.id, role: "USER" as const, content: turn.userMessage, createdAt: turn.createdAt },
        ...(turn.assistantReply ? [{ id: `share_${createHash("sha256").update(`${legacy.id}:${turn.id}:assistant`).digest("hex")}`, conversationId: legacy.id, role: "ASSISTANT" as const, content: turn.assistantReply, createdAt: turn.createdAt }] : []),
      ]);
      await this.prisma.$transaction([
        this.prisma.conversation.update({ where: { id: legacy.id }, data: { nadimConversationId: joined.conversationId } }),
        this.prisma.message.createMany({ data: messages, skipDuplicates: true }),
      ]);
      return { conversationId: legacy.id, title: legacy.title, mode: joined.mode };
    } catch (error) {
      await this.prisma.conversation.delete({ where: { id: legacy.id } }).catch(() => undefined);
      throw error;
    }
  }
}
