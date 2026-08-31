import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConversationTokenType, FollowUpTaskStatus, Prisma, PropertyRequirementStatus } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { NadimChannel } from "../dto/nadim-turn.dto";
import { NadimState } from "../domain/nadim-state";

const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const safeText = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

@Injectable()
export class CustomerLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureParticipant(input: { conversationId: string; channel: string; externalUserId: string; customerId?: string; owner?: boolean }) {
    return this.prisma.conversationParticipant.upsert({
      where: { conversationId_channel_externalUserId: { conversationId: input.conversationId, channel: input.channel, externalUserId: input.externalUserId } },
      create: {
        conversationId: input.conversationId,
        channel: input.channel,
        externalUserId: input.externalUserId,
        customerId: input.customerId,
        role: input.owner ? "OWNER" : "MEMBER",
        status: "ACTIVE",
      },
      update: { status: "ACTIVE", leftAt: null, customerId: input.owner ? input.customerId : undefined },
    });
  }

  async ensureCustomer(conversationId: string, channel: NadimChannel | string, externalUserId?: string) {
    const conversation = await this.prisma.nadimConversation.findFirst({ where: { id: conversationId, deletedAt: null } });
    if (!conversation) throw new NotFoundException({ code: "NADIM_CONVERSATION_NOT_FOUND", message: "Conversation not found", safe: true });
    let customerId = conversation.customerId ?? undefined;
    if (!customerId && externalUserId) {
      const identity = await this.prisma.customerChannelIdentity.findUnique({ where: { channel_externalId: { channel, externalId: externalUserId } } });
      customerId = identity?.customerId;
    }
    if (!customerId) {
      const customer = await this.prisma.customer.create({ data: {} });
      customerId = customer.id;
    }
    await this.prisma.nadimConversation.update({ where: { id: conversationId }, data: { customerId } });
    const participant = externalUserId && channel !== "N8N"
      ? await this.prisma.conversationParticipant.findUnique({ where: { conversationId_channel_externalUserId: { conversationId, channel, externalUserId } }, select: { role: true } })
      : null;
    if (externalUserId && channel !== "N8N" && participant?.role !== "MEMBER") {
      await this.prisma.customerChannelIdentity.upsert({
        where: { channel_externalId: { channel, externalId: externalUserId } },
        create: { customerId, channel, externalId: externalUserId, metadata: { source: "NADIM_PRODUCT_LAYER" } },
        update: {},
      });
      await this.ensureParticipant({ conversationId, channel, externalUserId, customerId, owner: true });
    }
    return customerId;
  }

  async saveRequirement(input: { conversationId: string; channel: NadimChannel; externalUserId?: string; state: NadimState; title?: string; status?: PropertyRequirementStatus; allowNew?: boolean }) {
    const customerId = await this.ensureCustomer(input.conversationId, input.channel, input.externalUserId);
    const search = input.state.search;
    const conversation = await this.prisma.nadimConversation.findUnique({ where: { id: input.conversationId }, select: { activeRequirementId: true, activeRequirement: true } });
    const data = {
      customerId,
      conversationId: input.conversationId,
      title: safeText(input.title, 120) || this.requirementTitle(search.locations, search.propertyTypes),
      purpose: search.purpose,
      propertyType: search.propertyTypes[0],
      locations: search.locations,
      preferredDevelopers: search.developers,
      preferredProjects: search.projects,
      bedrooms: search.bedrooms,
      bathrooms: search.bathrooms,
      areaMin: search.areaMin,
      areaMax: search.areaMax,
      budgetMin: search.budgetMin,
      budgetMax: search.budgetMax,
      currency: search.currency,
      paymentPreference: search.installmentPreference,
      deliveryPreference: search.deliveryMaxYears == null ? undefined : `WITHIN_${search.deliveryMaxYears}_YEARS`,
      recentResultIds: input.state.lastResultIds,
      selectedUnitId: input.state.selectedUnitId,
      selectedProjectId: input.state.selectedProjectId,
      comparisonUnitIds: input.state.comparisonUnitIds,
      status: input.status ?? "OPEN" as PropertyRequirementStatus,
    };
    const previous = conversation?.activeRequirement;
    // `allowNew` is granted only for an explicit independent-requirement turn.
    // Once granted, similarity must not collapse two customer briefs together.
    const createNew = Boolean(input.allowNew && previous);
    const requirement = conversation?.activeRequirementId && !createNew
      ? await this.prisma.propertyRequirement.update({ where: { id: conversation.activeRequirementId }, data })
      : await this.prisma.propertyRequirement.create({ data });
    await this.prisma.nadimConversation.update({ where: { id: input.conversationId }, data: { activeRequirementId: requirement.id } });
    return requirement;
  }

  async setRequirementStatus(id: string, status: PropertyRequirementStatus) {
    return this.prisma.propertyRequirement.update({ where: { id }, data: { status } });
  }

  async updateRequirementContext(conversationId: string, requirementId: string, state: NadimState) {
    return this.prisma.propertyRequirement.updateMany({
      where: { id: requirementId, conversationId, status: { not: "CLOSED" } },
      data: {
        recentResultIds: state.lastResultIds,
        selectedUnitId: state.selectedUnitId ?? null,
        selectedProjectId: state.selectedProjectId ?? null,
        comparisonUnitIds: state.comparisonUnitIds,
      },
    });
  }

  async activateRequirement(conversationId: string, requirementId: string) {
    const requirement = await this.prisma.propertyRequirement.findFirst({
      where: { id: requirementId, conversationId, status: { not: "CLOSED" } },
    });
    if (!requirement) throw new NotFoundException({ code: "PROPERTY_REQUIREMENT_NOT_FOUND", message: "Property requirement not found", safe: true });
    await this.prisma.nadimConversation.update({ where: { id: conversationId }, data: { activeRequirementId: requirement.id } });
    return requirement;
  }

  async conversationTimezone(conversationId: string) {
    const conversation = await this.prisma.nadimConversation.findFirst({
      where: { id: conversationId, deletedAt: null },
      select: { timezone: true, customer: { select: { timezone: true } } },
    });
    if (!conversation) throw new NotFoundException({ code: "NADIM_CONVERSATION_NOT_FOUND", message: "Conversation not found", safe: true });
    return conversation.timezone ?? conversation.customer?.timezone ?? undefined;
  }

  async createFollowUp(input: {
    conversationId: string; channel: NadimChannel; externalUserId?: string; dueAt: Date; timezone: string;
    reason: string; messageIntent: Record<string, unknown>; renderedMessage?: string; propertyRequirementId?: string; dedupeSource?: string;
  }) {
    if (!this.validTimezone(input.timezone)) throw new BadRequestException({ code: "TIMEZONE_REQUIRED", message: "A valid customer timezone is required", safe: true });
    if (!Number.isFinite(input.dueAt.getTime()) || input.dueAt <= new Date()) throw new BadRequestException({ code: "INVALID_FOLLOWUP_TIME", message: "Follow-up time must be in the future", safe: true });
    const customerId = await this.ensureCustomer(input.conversationId, input.channel, input.externalUserId);
    const conversation = await this.prisma.nadimConversation.findUniqueOrThrow({ where: { id: input.conversationId } });
    const outboundAddress = safeText(input.externalUserId ?? conversation.externalUserId, 300);
    if (!outboundAddress) throw new BadRequestException({ code: "FOLLOWUP_ADDRESS_REQUIRED", message: "A delivery address is required", safe: true });
    const bucket = Math.floor(Date.now() / (10 * 60_000));
    const dedupeKey = createHash("sha256").update(`${input.conversationId}:${input.dedupeSource ?? input.reason}:${bucket}`, "utf8").digest("hex");
    const existing = await this.prisma.followUpTask.findUnique({ where: { dedupeKey } });
    if (existing) return existing;
    try {
      return await this.prisma.followUpTask.create({ data: {
        customerId,
        conversationId: input.conversationId,
        propertyRequirementId: input.propertyRequirementId,
        channel: input.channel,
        outboundAddress,
        dueAt: input.dueAt,
        timezone: input.timezone,
        reason: safeText(input.reason, 500) || "Customer requested follow-up",
        messageIntent: json(input.messageIntent),
        renderedMessage: safeText(input.renderedMessage, 2_000) || null,
        dedupeKey,
      } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") {
        const duplicate = await this.prisma.followUpTask.findUnique({ where: { dedupeKey } });
        if (duplicate) return duplicate;
      }
      throw error;
    }
  }

  async recordHumanActivity(input: { channel: string; externalUserId: string; occurredAt?: string | number }) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { channel: input.channel, externalUserId: input.externalUserId, status: "ACTIVE", conversation: { deletedAt: null } },
      orderBy: { joinedAt: "desc" }, select: { conversationId: true },
    });
    const conversation = participant
      ? await this.prisma.nadimConversation.findUnique({ where: { id: participant.conversationId } })
      : await this.prisma.nadimConversation.findFirst({ where: { channel: input.channel, externalUserId: input.externalUserId, deletedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!conversation) return { recorded: false, mode: "AI" as const };
    if (conversation.mode !== "HUMAN") return { recorded: false, mode: conversation.mode };
    const occurredAt = this.safeOccurredAt(input.occurredAt);
    const updated = await this.prisma.nadimConversation.updateMany({
      where: { id: conversation.id, mode: "HUMAN", OR: [{ lastHumanMessageAt: null }, { lastHumanMessageAt: { lt: occurredAt } }] },
      data: { lastHumanMessageAt: occurredAt },
    });
    return { recorded: updated.count === 1, mode: "HUMAN" as const };
  }

  async releaseStaleHuman(inactiveForHours: number) {
    if (!Number.isFinite(inactiveForHours) || inactiveForHours < 1 || inactiveForHours > 24 * 30) {
      throw new BadRequestException({ code: "INVALID_INACTIVITY_WINDOW", message: "inactiveForHours must be between 1 and 720", safe: true });
    }
    const cutoff = new Date(Date.now() - inactiveForHours * 3_600_000);
    const candidates = await this.prisma.nadimConversation.findMany({
      where: { mode: "HUMAN", deletedAt: null, OR: [{ lastHumanMessageAt: { lte: cutoff } }, { lastHumanMessageAt: null, humanModeSince: { lte: cutoff } }] },
      select: { id: true }, take: 1_000,
    });
    const released: Array<{ conversationId: string }> = [];
    for (const candidate of candidates) {
      const changed = await this.prisma.nadimConversation.updateMany({
        where: { id: candidate.id, mode: "HUMAN", OR: [{ lastHumanMessageAt: { lte: cutoff } }, { lastHumanMessageAt: null, humanModeSince: { lte: cutoff } }] },
        data: { mode: "AI", modeChangedAt: new Date(), humanModeSince: null, lastHumanMessageAt: null },
      });
      if (changed.count === 1) released.push({ conversationId: candidate.id });
    }
    return { releasedCount: released.length, released };
  }

  async claimDue(workerId: string, limit: number) {
    const now = new Date();
    await this.prisma.followUpTask.updateMany({
      where: { status: "CLAIMED", claimedAt: { lte: new Date(now.getTime() - 15 * 60_000) }, attempts: { lt: 3 } },
      data: { status: "PENDING", claimedAt: null, claimedBy: null },
    });
    const rows = await this.prisma.followUpTask.findMany({
      where: { status: "PENDING", dueAt: { lte: now }, attempts: { lt: 3 }, conversation: { deletedAt: null }, OR: [{ safeDuringHuman: true }, { conversation: { mode: { not: "HUMAN" } } }] },
      orderBy: [{ dueAt: "asc" }, { createdAt: "asc" }], take: Math.min(Math.max(limit, 1), 100),
      include: { conversation: { select: { locale: true, mode: true } } },
    });
    const tasks: Array<{ id: string; conversationId: string; channel: string; outboundAddress: string; text: string }> = [];
    for (const row of rows) {
      if (row.conversation.mode === "HUMAN" && !row.safeDuringHuman) continue;
      const claimed = await this.prisma.followUpTask.updateMany({
        where: { id: row.id, status: "PENDING", attempts: { lt: row.maxAttempts } },
        data: { status: "CLAIMED", claimedAt: new Date(), claimedBy: workerId, attempts: { increment: 1 } },
      });
      if (claimed.count === 1) tasks.push({ id: row.id, conversationId: row.conversationId, channel: row.channel, outboundAddress: row.outboundAddress, text: row.renderedMessage || this.fallbackFollowUp(row.conversation.locale) });
    }
    return { tasks };
  }

  async markSent(id: string, provider: string, providerMessageId?: string | null) {
    const existing = await this.prisma.followUpTask.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: "FOLLOWUP_NOT_FOUND", message: "Follow-up task not found", safe: true });
    if (existing.status === "SENT") return { id, status: "SENT", sentAt: existing.sentAt, idempotent: true };
    const sentAt = new Date();
    const changed = await this.prisma.followUpTask.updateMany({ where: { id, status: "CLAIMED" }, data: { status: "SENT", sentAt, provider: safeText(provider, 80), providerMessageId: safeText(providerMessageId, 300) || null, lastError: null } });
    if (changed.count === 1) return { id, status: "SENT" as const, sentAt };
    const latest = await this.prisma.followUpTask.findUnique({ where: { id } });
    if (latest?.status === "SENT") return { id, status: "SENT" as const, sentAt: latest.sentAt, idempotent: true };
    throw new ConflictException({ code: "FOLLOWUP_NOT_CLAIMED", message: "Follow-up task is not claimed", safe: true });
  }

  async markFailed(id: string, provider: string, reason: string) {
    const existing = await this.prisma.followUpTask.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ code: "FOLLOWUP_NOT_FOUND", message: "Follow-up task not found", safe: true });
    if (existing.status === "SENT") return { id, status: "SENT", idempotent: true };
    if (existing.status === "FAILED") return { id, status: "FAILED", idempotent: true };
    const retryable = existing.attempts < existing.maxAttempts;
    const changed = await this.prisma.followUpTask.updateMany({ where: { id, status: "CLAIMED" }, data: {
      status: retryable ? "PENDING" : "FAILED",
      failedAt: retryable ? null : new Date(), provider: safeText(provider, 80), lastError: safeText(reason, 1_000),
      claimedAt: null, claimedBy: null,
    } });
    if (changed.count === 1) return { id, status: retryable ? "PENDING" as const : "FAILED" as const, attempts: existing.attempts, retryable };
    const latest = await this.prisma.followUpTask.findUnique({ where: { id } });
    if (latest?.status === "SENT" || latest?.status === "FAILED") return { id, status: latest.status, attempts: latest.attempts, retryable: false, idempotent: true };
    throw new ConflictException({ code: "FOLLOWUP_NOT_CLAIMED", message: "Follow-up task is not claimed", safe: true });
  }

  async createToken(input: { conversationId: string; type: ConversationTokenType; createdByParticipantId?: string; ttlMinutes?: number; maxUses?: number }) {
    const conversation = await this.prisma.nadimConversation.findFirst({ where: { id: input.conversationId, deletedAt: null }, select: { id: true } });
    if (!conversation) throw new NotFoundException({ code: "NADIM_CONVERSATION_NOT_FOUND", message: "Conversation not found", safe: true });
    const prefix = input.type === "WEB_SHARE" ? "nsh_" : "nwh_";
    const token = `${prefix}${randomBytes(32).toString("base64url")}`;
    const ttl = Math.min(Math.max(input.ttlMinutes ?? (input.type === "WEB_SHARE" ? 60 * 24 * 7 : 15), 1), 60 * 24 * 30);
    const record = await this.prisma.conversationShareToken.create({ data: {
      conversationId: input.conversationId,
      createdByParticipantId: input.createdByParticipantId,
      tokenHash: hashToken(token), type: input.type,
      expiresAt: new Date(Date.now() + ttl * 60_000),
      maxUses: input.maxUses ?? (input.type === "WEB_SHARE" ? null : 1),
    } });
    return { id: record.id, token, expiresAt: record.expiresAt };
  }

  async consumeToken(input: { token: string; expectedType: ConversationTokenType | ConversationTokenType[]; channel: string; externalUserId: string; customerId?: string }) {
    const tokenHash = hashToken(input.token);
    return this.prisma.$transaction(async (tx) => {
      const record = await tx.conversationShareToken.findUnique({ where: { tokenHash }, include: { conversation: { select: { id: true, deletedAt: true, mode: true } } } });
      const expectedTypes = Array.isArray(input.expectedType) ? input.expectedType : [input.expectedType];
      if (!record || !expectedTypes.includes(record.type) || record.revokedAt || record.conversation.deletedAt || record.expiresAt <= new Date() || record.consumedAt || (record.maxUses != null && record.usedCount >= record.maxUses)) {
        throw new NotFoundException({ code: "SHARE_TOKEN_INVALID", message: "This conversation link is invalid or expired", safe: true });
      }
      const usedCount = record.usedCount + 1;
      await tx.conversationShareToken.update({ where: { id: record.id }, data: { usedCount, consumedAt: record.maxUses != null && usedCount >= record.maxUses ? new Date() : undefined } });
      const participant = await tx.conversationParticipant.upsert({
        where: { conversationId_channel_externalUserId: { conversationId: record.conversationId, channel: input.channel, externalUserId: input.externalUserId } },
        create: { conversationId: record.conversationId, channel: input.channel, externalUserId: input.externalUserId, customerId: input.customerId, role: "MEMBER", status: "ACTIVE" },
        update: { status: "ACTIVE", leftAt: null },
      });
      return { conversationId: record.conversationId, participantId: participant.id, mode: record.conversation.mode, permission: record.permission };
    });
  }

  async validateToken(token: string, expectedType: ConversationTokenType) {
    const record = await this.prisma.conversationShareToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { conversation: { select: { id: true, deletedAt: true, mode: true } } } });
    if (!record || record.type !== expectedType || record.revokedAt || record.conversation.deletedAt || record.expiresAt <= new Date() || record.consumedAt || (record.maxUses != null && record.usedCount >= record.maxUses)) {
      throw new NotFoundException({ code: "SHARE_TOKEN_INVALID", message: "This conversation link is invalid or expired", safe: true });
    }
    return { mode: record.conversation.mode, permission: record.permission, expiresAt: record.expiresAt };
  }

  async revokeToken(id: string, conversationId: string) {
    const changed = await this.prisma.conversationShareToken.updateMany({ where: { id, conversationId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!changed.count) throw new NotFoundException({ code: "SHARE_TOKEN_NOT_FOUND", message: "Share link not found", safe: true });
    return { revoked: true };
  }

  private safeOccurredAt(value?: string | number) {
    const now = new Date();
    const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d{10,13}$/u.test(value) ? Number(value) : undefined;
    const parsed = value == null ? now : new Date(numeric == null ? value : numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 5 * 60_000 || parsed.getTime() < now.getTime() - 7 * 24 * 60 * 60_000) return now;
    return parsed;
  }

  private validTimezone(value: string) { try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; } }
  private fallbackFollowUp(locale?: string | null) { return locale?.toLowerCase().startsWith("ar") ? "أهلاً، بتابع معاك بخصوص طلبك العقاري. تحب نكمل من حيث وقفنا؟" : "Hi, I’m following up on your property request. Would you like to continue where we left off?"; }
  private requirementTitle(locations: string[], types: string[]) { return [types[0], locations[0]].filter(Boolean).join(" · ") || "Property requirement"; }
}
