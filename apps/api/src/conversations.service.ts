import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "./database/prisma.service";
import { DevicesService } from "./devices.service";
import { PromptABTestingService } from "./providers/prompt-ab-testing.service";
import { createHash } from "node:crypto";

@Injectable()
export class ConversationsService {
  constructor(private readonly prisma: PrismaService, private readonly devices: DevicesService, private readonly promptABTesting: PromptABTestingService) {}
  private async owned(id: string, rawToken: string) {
    const device = await this.devices.resolve(rawToken);
    const conversation = await this.prisma.conversation.findFirst({ where: { id, deviceId: device.id } });
    if (!conversation) throw new NotFoundException("Conversation not found");
    return { device, conversation };
  }
  async list(rawToken: string) {
    const device = await this.devices.resolve(rawToken);
    const rows = await this.prisma.conversation.findMany({ where: { deviceId: device.id }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true, detectedLanguage: true, nadimConversationId: true, nadimConversation: { select: { mode: true } }, createdAt: true, updatedAt: true, state: { select: { searchContext: true } }, _count: { select: { messages: true } } } });
    return rows.map((row) => {
      const context = row.state?.searchContext as any;
      return { ...row, mode: row.nadimConversation?.mode ?? "AI", nadimConversation: undefined, closed: Boolean(context?.presentation?.conversationClosed), state: undefined };
    });
  }
  async create(rawToken: string, title?: string) {
    const device = await this.devices.resolve(rawToken);
    const promptVariant = await this.promptABTesting.nextVariant();
    return this.prisma.conversation.create({ data: { deviceId: device.id, title: title?.slice(0, 80) || "New conversation", promptVariant } });
  }
  async rename(id: string, rawToken: string, title: string) { const { conversation } = await this.owned(id, rawToken); return this.prisma.conversation.update({ where: { id: conversation.id }, data: { title: title.trim().slice(0, 80) } }); }
  async remove(id: string, rawToken: string) {
    const { conversation } = await this.owned(id, rawToken);
    if (conversation.nadimConversationId) {
      const externalUserId = `web:${createHash("sha256").update(`${rawToken}:${conversation.id}`).digest("hex")}`;
      const participant = await this.prisma.conversationParticipant.findUnique({
        where: { conversationId_channel_externalUserId: { conversationId: conversation.nadimConversationId, channel: "WEB", externalUserId } },
        select: { id: true, role: true },
      });
      if (participant?.role === "MEMBER") {
        await this.prisma.$transaction([
          this.prisma.conversation.delete({ where: { id: conversation.id } }),
          this.prisma.conversationParticipant.update({ where: { id: participant.id }, data: { status: "LEFT", leftAt: new Date() } }),
        ]);
        return { deleted: true };
      }
      await this.prisma.$transaction([
        this.prisma.conversation.deleteMany({ where: { nadimConversationId: conversation.nadimConversationId } }),
        this.prisma.nadimConversation.delete({ where: { id: conversation.nadimConversationId } }),
      ]);
    } else {
      await this.prisma.conversation.delete({ where: { id: conversation.id } });
    }
    return { deleted: true };
  }
  async messages(id: string, rawToken: string) { await this.owned(id, rawToken); return this.prisma.message.findMany({ where: { conversationId: id, role: { in: ["USER", "ASSISTANT"] } }, orderBy: { createdAt: "asc" } }); }
  async assertOwned(id: string, rawToken: string) { return this.owned(id, rawToken); }
}
