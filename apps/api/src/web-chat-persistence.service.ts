import { ConflictException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { ConversationsService } from "./conversations.service";

type PersistNadimWebTurn = {
  legacyConversationId: string;
  nadimConversationId: string;
  deviceToken: string;
  eventId: string;
  userMessage: string;
  assistantReply: string;
  resultMetadata?: Record<string, unknown>;
};

const messageId = (eventId: string, role: "user" | "assistant") =>
  `nadim_${createHash("sha256").update(`WEB:${eventId}:${role}`).digest("hex")}`;

@Injectable()
export class WebChatPersistenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
  ) {}

  async persist(input: PersistNadimWebTurn) {
    const { conversation } = await this.conversations.assertOwned(input.legacyConversationId, input.deviceToken);
    if (conversation.nadimConversationId && conversation.nadimConversationId !== input.nadimConversationId) {
      throw new ConflictException({ code: "WEB_NADIM_CONVERSATION_CONFLICT", message: "The web conversation is already linked to a different Nadim conversation", safe: true });
    }

    const userId = messageId(input.eventId, "user");
    const assistantId = messageId(input.eventId, "assistant");
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { nadimConversationId: input.nadimConversationId },
      }),
      this.prisma.message.createMany({
        data: [
          { id: userId, conversationId: conversation.id, role: "USER", content: input.userMessage },
          {
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
          },
        ],
        skipDuplicates: true,
      }),
    ]);

    return this.prisma.message.findUniqueOrThrow({ where: { id: assistantId } });
  }
}
