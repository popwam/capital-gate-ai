import { Injectable } from "@nestjs/common";
import { LeadIntent, LeadStatus, Prisma } from "@prisma/client";
import { AutomationError } from "../common/automation-error";
import { CustomerIdentityService, NormalizedUpsertRequest, normalizeRequest } from "../customers/customer-identity.service";
import { PrismaService } from "../database/prisma.service";
import { IdempotencyService } from "../idempotency/idempotency.service";
import { UpsertLeadDto } from "./dto/upsert-lead.dto";

type JsonObject = Record<string, unknown>;
type UpsertResponse = {
  ok: boolean;
  action: "LEAD_UPSERT";
  replayed: boolean;
  customer?: { id: string; created: boolean; updated: boolean };
  lead?: { id: string; created: boolean; updated: boolean } | null;
  reason?: string;
  error?: { code: string; message: string };
};

function object(value: Prisma.JsonValue | null | undefined): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function machineMetadata(request: NormalizedUpsertRequest) {
  return {
    source: request.source,
    channel: request.channel,
    idempotencyKey: request.idempotencyKey,
    ...(request.context?.eventId ? { eventId: request.context.eventId } : {}),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identities: CustomerIdentityService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async upsert(input: UpsertLeadDto): Promise<UpsertResponse> {
    let request: NormalizedUpsertRequest;
    try {
      request = normalizeRequest(input);
      if (!request.idempotencyKey) throw new AutomationError("INVALID_IDEMPOTENCY_KEY", "idempotencyKey must not be empty");
      if (request.lead?.budgetMin != null && request.lead?.budgetMax != null && request.lead.budgetMin > request.lead.budgetMax) {
        throw new AutomationError("INVALID_BUDGET_RANGE", "budgetMin must not exceed budgetMax");
      }
    } catch (error) {
      if (error instanceof AutomationError) return this.failure(error);
      throw error;
    }
    const claim = await this.idempotency.claim(request.idempotencyKey, request.source, request);
    if (claim.replay) return claim.replay as UpsertResponse;
    try {
      const response = await this.prisma.$transaction(async (tx) => {
        const result = await this.execute(tx, request);
        const entity = result.lead
          ? { type: "Lead" as const, id: result.lead.id }
          : { type: "Customer" as const, id: result.customer!.id };
        await this.idempotency.complete(tx, claim.execution.id, result, entity);
        return result;
      });
      return response;
    } catch (error) {
      const normalized = error instanceof AutomationError
        ? error
        : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
          ? new AutomationError("CUSTOMER_IDENTITY_CONFLICT", "A customer identity was claimed concurrently by another customer", 409)
          : new AutomationError("INTERNAL_ERROR", "The lead action could not be completed", 500);
      const response = this.failure(normalized);
      await this.idempotency.fail(claim.execution.id, response, normalized.code);
      return response;
    }
  }

  private failure(error: AutomationError): UpsertResponse {
    return { ok: false, action: "LEAD_UPSERT", replayed: false, error: { code: error.code, message: error.message } };
  }

  private async execute(tx: Prisma.TransactionClient, request: NormalizedUpsertRequest): Promise<UpsertResponse> {
    const resolved = await this.identities.resolve(tx, request);
    const customer = resolved.customer;
    if (request.context?.conversationId) {
      const exists = await tx.conversation.findUnique({ where: { id: request.context.conversationId }, select: { id: true } });
      if (!exists) throw new AutomationError("CONVERSATION_NOT_FOUND", "The supplied conversationId does not exist", 404);
    }

    let lead = request.leadId
      ? await tx.lead.findUnique({ where: { id: request.leadId } })
      : await tx.lead.findFirst({
          where: { customerId: customer.id, status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } },
          orderBy: { updatedAt: "desc" },
        });
    if (request.leadId && !lead) throw new AutomationError("LEAD_NOT_FOUND", "The explicit leadId does not exist", 404);
    if (lead?.customerId && lead.customerId !== customer.id) {
      throw new AutomationError("LEAD_CUSTOMER_CONFLICT", "The lead belongs to a different customer", 409);
    }
    let legacyMatch = false;
    if (!lead && request.customer?.normalizedPhone) {
      lead = await tx.lead.findFirst({
        where: {
          customerId: null,
          phone: request.customer.normalizedPhone,
          status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        },
        orderBy: { updatedAt: "desc" },
      });
      legacyMatch = Boolean(lead);
    }

    if (!lead && !request.lead) {
      await tx.auditLog.create({ data: {
        action: "AUTOMATION_CUSTOMER_RESOLVED",
        entityType: "Customer",
        entityId: customer.id,
        metadata: json(machineMetadata(request)),
      } });
      return {
        ok: true,
        action: "LEAD_UPSERT",
        replayed: false,
        customer: { id: customer.id, created: resolved.created, updated: resolved.updated },
        lead: null,
        reason: "INSUFFICIENT_LEAD_DATA",
      };
    }

    const eventMetadata = machineMetadata(request);
    let leadCreated = false;
    let leadUpdated = false;
    if (lead) {
      const attached = !lead.customerId;
      const data = this.updateData(lead, request, customer);
      if (attached) data.customer = { connect: { id: customer.id } };
      if (request.context?.conversationId && !lead.conversationId) data.conversation = { connect: { id: request.context.conversationId } };
      const changedFields = Object.keys(data);
      if (changedFields.length) {
        lead = await tx.lead.update({ where: { id: lead.id }, data });
        leadUpdated = true;
        await tx.leadEvent.create({ data: {
          leadId: lead.id,
          type: "AUTOMATION_LEAD_UPDATED",
          payload: json({ ...eventMetadata, changedFields, legacyMatch }),
        } });
      }
      if (attached) {
        await tx.leadEvent.create({ data: { leadId: lead.id, type: "CUSTOMER_ATTACHED", payload: json(eventMetadata) } });
      }
    } else {
      const payload = this.mergedPayload({}, request);
      lead = await tx.lead.create({ data: {
        customerId: customer.id,
        conversationId: request.context?.conversationId,
        name: request.customer?.name ?? customer.name,
        phone: request.customer?.normalizedPhone ?? customer.normalizedPhone,
        intent: request.lead?.intent ?? LeadIntent.INQUIRY,
        intentScore: request.lead?.intentScore ?? 0,
        payload: json(payload),
        source: request.source,
        trustStatus: "NEEDS_VERIFICATION",
        trustScore: 0,
        trustReasons: ["automation_origin"],
        preferredContactChannel: request.lead?.preferredContactChannel,
        preferredConfirmationChannel: request.lead?.preferredConfirmationChannel,
        followUpAt: request.lead?.followUpAt ? new Date(request.lead.followUpAt) : undefined,
      } });
      leadCreated = true;
      await tx.leadEvent.create({ data: { leadId: lead.id, type: "AUTOMATION_LEAD_CREATED", payload: json(eventMetadata) } });
    }
    await tx.auditLog.create({ data: {
      action: leadCreated ? "AUTOMATION_LEAD_CREATED" : leadUpdated ? "AUTOMATION_LEAD_UPDATED" : "AUTOMATION_LEAD_RESOLVED",
      entityType: "Lead",
      entityId: lead.id,
      metadata: json(eventMetadata),
    } });
    return {
      ok: true,
      action: "LEAD_UPSERT",
      replayed: false,
      customer: { id: customer.id, created: resolved.created, updated: resolved.updated },
      lead: { id: lead.id, created: leadCreated, updated: leadUpdated },
    };
  }

  private updateData(lead: { payload: Prisma.JsonValue; name: string | null; phone: string | null }, request: NormalizedUpsertRequest, customer: { name: string | null; normalizedPhone: string | null }) {
    const data: Prisma.LeadUpdateInput = {};
    const input = request.lead;
    if (request.customer?.name && request.customer.name !== lead.name) data.name = request.customer.name;
    if (request.customer?.normalizedPhone && request.customer.normalizedPhone !== lead.phone) data.phone = request.customer.normalizedPhone;
    if (input?.intent !== undefined) data.intent = input.intent;
    if (input?.intentScore !== undefined) data.intentScore = input.intentScore;
    if (input?.preferredContactChannel !== undefined) data.preferredContactChannel = input.preferredContactChannel;
    if (input?.preferredConfirmationChannel !== undefined) data.preferredConfirmationChannel = input.preferredConfirmationChannel;
    if (input?.followUpAt !== undefined) data.followUpAt = new Date(input.followUpAt);
    if (input && Object.keys(input).some((key) => ["purpose", "budgetMin", "budgetMax", "currency", "notes"].includes(key))) {
      data.payload = json(this.mergedPayload(object(lead.payload), request));
    }
    return data;
  }

  private mergedPayload(existing: JsonObject, request: NormalizedUpsertRequest) {
    const requirements = object(existing.requirements as Prisma.JsonValue | undefined);
    const input = request.lead;
    const supplied = Object.fromEntries(Object.entries({
      purpose: input?.purpose,
      budgetMin: input?.budgetMin,
      budgetMax: input?.budgetMax,
      currency: input?.currency,
      preferredContactChannel: input?.preferredContactChannel,
      preferredConfirmationChannel: input?.preferredConfirmationChannel,
    }).filter(([, value]) => value !== undefined));
    return {
      ...existing,
      requirements: { ...requirements, ...supplied },
      ...(input?.notes ? { automationNotes: [...(Array.isArray(existing.automationNotes) ? existing.automationNotes : []), { text: input.notes, ...machineMetadata(request) }] } : {}),
      automationContext: {
        ...object(existing.automationContext as Prisma.JsonValue | undefined),
        ...machineMetadata(request),
        ...(request.context?.metadata ? { metadata: request.context.metadata } : {}),
      },
    };
  }
}
