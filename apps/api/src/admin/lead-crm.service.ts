import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { LeadIntent, LeadStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  AdminConversationExportQueryDto,
  AdminConversationListQueryDto,
  CreateLeadNoteDto,
  LeadListQueryDto,
  UpdateLeadDto,
  TrustAlertFeedbackDto,
} from "./lead-crm.dto";
import { createConversationExport } from "./conversation-export";
import { CustomerLifecycleService } from "../nadim-v2/product/customer-lifecycle.service";
import { randomUUID } from "node:crypto";

type JsonObject = Record<string, any>;

@Injectable()
export class LeadCrmService {
  private static readonly MAX_CONVERSATION_EXPORT = 2_000;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Optional() private readonly lifecycle?: CustomerLifecycleService,
  ) {}

  private json(value: Prisma.JsonValue): JsonObject {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : {};
  }
  private summary(payload: Prisma.JsonValue) {
    const data = this.json(payload);
    const requirements = this.json(data.requirements ?? {});
    const summary = this.json(data.conversationSummary ?? {});
    const { recentConversation: _recentConversation, ...structuredConversationSummary } = summary;
    const budget = this.json(summary.budget ?? {});
    const presentation = this.json(requirements.presentation ?? {});
    const selectedUnitId = typeof presentation.selectedUnitId === "string" ? presentation.selectedUnitId : null;
    const selectedProjectId = typeof presentation.selectedProjectId === "string" ? presentation.selectedProjectId : null;
    return {
      budget:
        budget.min != null || budget.max != null
          ? {
              min: budget.min ?? null,
              max: budget.max ?? null,
              currency: budget.currency ?? requirements.currency ?? null,
            }
          : null,
      preferredAreas:
        summary.preferredLocations ?? requirements.locations ?? [],
      propertyTypes: summary.propertyTypes ?? requirements.propertyTypes ?? [],
      bedrooms: summary.bedrooms ?? requirements.bedrooms ?? null,
      purpose: summary.customerGoal ?? requirements.purpose ?? null,
      deliveryMaxYears: requirements.deliveryMaxYears ?? null,
      maxDownPayment: requirements.maxDownPayment ?? null,
      hardRequirements:
        summary.hardRequirements ?? requirements.hardRequirements ?? [],
      softPreferences:
        summary.softPreferences ?? requirements.softPreferences ?? [],
      interestedProjectIds: selectedProjectId
        ? [selectedProjectId]
        : Array.isArray(data.interestedProjects)
          ? data.interestedProjects
          : [],
      // Old leads may contain every ranked suggestion because of the previous
      // persistence bug. The selected entity in PresentationState is the stronger
      // signal and lets the CRM self-heal without destructive SQL cleanup.
      interestedUnitIds: selectedUnitId
        ? [selectedUnitId]
        : Array.isArray(data.explicitInterestedUnits) && data.explicitInterestedUnits.length
          ? data.explicitInterestedUnits
          : Array.isArray(data.interestedUnits)
            ? data.interestedUnits
            : [],
      conversationSummary: structuredConversationSummary,
    };
  }

  private async where(query: LeadListQueryDto): Promise<Prisma.LeadWhereInput> {
    const AND: Prisma.LeadWhereInput[] = [];
    if (query.status) AND.push({ status: query.status });
    if (query.trustStatus) AND.push({ trustStatus: query.trustStatus });
    if (query.projectId)
      AND.push({
        payload: {
          path: ["interestedProjects"],
          array_contains: [query.projectId],
        },
      });
    if (query.assignedTo === "unassigned")
      AND.push({ assignedToAdminId: null });
    else if (query.assignedTo)
      AND.push({ assignedToAdminId: query.assignedTo });
    if (query.intentLevel === "high") AND.push({ intentScore: { gte: 80 } });
    if (query.intentLevel === "medium")
      AND.push({ intentScore: { gte: 50, lt: 80 } });
    if (query.intentLevel === "low") AND.push({ intentScore: { lt: 50 } });
    const now = new Date();
    if (query.followUp === "due") AND.push({ followUpAt: { lte: now } });
    if (query.followUp === "upcoming") AND.push({ followUpAt: { gt: now } });
    if (query.followUp === "none") AND.push({ followUpAt: null });
    if (query.createdFrom || query.createdTo)
      AND.push({
        createdAt: {
          gte: query.createdFrom ? new Date(query.createdFrom) : undefined,
          lte: query.createdTo
            ? new Date(`${query.createdTo.slice(0, 10)}T23:59:59.999Z`)
            : undefined,
        },
      });
    if (query.search?.trim()) {
      const search = query.search.trim();
      const [projects, units] = await Promise.all([
        this.prisma.project.findMany({
          where: { name: { contains: search, mode: "insensitive" } },
          select: { id: true },
          take: 50,
        }),
        this.prisma.unit.findMany({
          where: { externalUnitId: { contains: search, mode: "insensitive" } },
          select: { id: true },
          take: 50,
        }),
      ]);
      AND.push({
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search } },
          { customer: { is: { name: { contains: search, mode: "insensitive" } } } },
          { customer: { is: { normalizedPhone: { contains: search } } } },
          { customer: { is: { normalizedEmail: { contains: search, mode: "insensitive" } } } },
          ...projects.map(
            (item) =>
              ({
                payload: {
                  path: ["interestedProjects"],
                  array_contains: [item.id],
                },
              }) as Prisma.LeadWhereInput,
          ),
          ...units.map(
            (item) =>
              ({
                payload: {
                  path: ["interestedUnits"],
                  array_contains: [item.id],
                },
              }) as Prisma.LeadWhereInput,
          ),
        ],
      });
    }
    return AND.length ? { AND } : {};
  }

  async list(query: LeadListQueryDto) {
    const where = await this.where(query);
    const skip = (query.page - 1) * query.limit;
    const orderBy: Prisma.LeadOrderByWithRelationInput =
      query.sort === "oldest"
        ? { createdAt: "asc" }
        : query.sort === "highest_intent"
          ? { intentScore: "desc" }
          : query.sort === "lowest_intent"
            ? { intentScore: "asc" }
            : query.sort === "follow_up"
              ? { followUpAt: { sort: "asc", nulls: "last" } }
              : query.sort === "last_activity"
                ? { updatedAt: "desc" }
                : { createdAt: "desc" };
    const [total, leads] = await this.prisma.$transaction([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        skip,
        take: query.limit,
        orderBy,
        include: {
          assignedTo: { select: { id: true, name: true, email: true } },
          customer: { select: { id: true, name: true, normalizedPhone: true, normalizedEmail: true } },
          conversation: { select: { id: true, title: true } },
          events: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
          notes: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true },
          },
        },
      }),
    ]);
    const summaries = leads.map((lead) => this.summary(lead.payload));
    const unitIds = [
      ...new Set(summaries.flatMap((item) => item.interestedUnitIds)),
    ];
    const projectIds = [
      ...new Set(summaries.flatMap((item) => item.interestedProjectIds)),
    ];
    const [units, projects] = await Promise.all([
      this.prisma.unit.findMany({
        where: { id: { in: unitIds } },
        select: {
          id: true,
          externalUnitId: true,
          projectId: true,
          project: { select: { id: true, name: true } },
        },
      }),
      this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      }),
    ]);
    const unitMap = new Map(units.map((item) => [item.id, item]));
    const projectMap = new Map(projects.map((item) => [item.id, item]));
    return {
      items: leads.map((lead, index) => {
        const summary = summaries[index];
        const firstUnit = summary.interestedUnitIds
          .map((id: string) => unitMap.get(id))
          .find(Boolean);
        const firstProject =
          summary.interestedProjectIds
            .map((id: string) => projectMap.get(id))
            .find(Boolean) ?? firstUnit?.project;
        return {
          id: lead.id,
          name: lead.name ?? lead.customer?.name ?? null,
          phone: lead.phone ?? lead.customer?.normalizedPhone ?? null,
          status: lead.status,
          intent: lead.intent,
          intentScore: lead.intentScore,
          trustStatus: lead.trustStatus,
          trustScore: lead.trustScore,
          trustReasons: lead.trustReasons,
          preferredContactChannel: lead.preferredContactChannel,
          preferredConfirmationChannel: lead.preferredConfirmationChannel,
          budget: summary.budget,
          preferredAreas: summary.preferredAreas,
          interestedProject: firstProject ?? null,
          interestedUnit: firstUnit
            ? { id: firstUnit.id, externalUnitId: firstUnit.externalUnitId }
            : null,
          createdAt: lead.createdAt,
          lastActivityAt: [
            lead.updatedAt,
            lead.events[0]?.createdAt,
            lead.notes[0]?.createdAt,
          ]
            .filter(Boolean)
            .sort((a, b) => +new Date(b!) - +new Date(a!))[0],
          assignedTo: lead.assignedTo,
          followUpAt: lead.followUpAt,
          conversation: lead.conversation,
        };
      }),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async detail(id: string) {
    const lead = await this.prisma.lead.findUnique({
      where: { id },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        customer: { select: { id: true, name: true, normalizedPhone: true, normalizedEmail: true } },
        conversation: {
          select: {
            id: true,
            title: true,
            createdAt: true,
            updatedAt: true,
            detectedLanguage: true,
            state: { select: { summary: true, searchContext: true } },
            messages: {
              orderBy: { createdAt: "asc" },
              select: { id: true, role: true, content: true, createdAt: true },
            },
          },
        },
        notes: {
          orderBy: { createdAt: "desc" },
          include: { adminUser: { select: { id: true, name: true } } },
        },
        trustAlerts: { orderBy: { createdAt: "desc" }, take: 20 },
        events: {
          orderBy: { createdAt: "desc" },
          include: { adminUser: { select: { id: true, name: true } } },
        },
      },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    const summary = this.summary(lead.payload);
    const [units, projects] = await Promise.all([
      this.prisma.unit.findMany({
        where: { id: { in: summary.interestedUnitIds } },
        select: {
          id: true,
          externalUnitId: true,
          price: true,
          currency: true,
          unitType: true,
          bedrooms: true,
          bathrooms: true,
          builtUpArea: true,
          phaseRef: { select: { id: true, name: true, nameAr: true, nameEn: true } },
          status: true,
          project: { select: { id: true, name: true, nameAr: true, nameEn: true, formattedAddress: true, location: { select: { name: true, nameAr: true, nameEn: true, formattedAddress: true } }, developer: { select: { name: true, nameAr: true, nameEn: true, brandName: true } } } },
        },
      }),
      this.prisma.project.findMany({
        where: { id: { in: summary.interestedProjectIds } },
        select: { id: true, name: true, developer: { select: { name: true } } },
      }),
    ]);
    return {
      id: lead.id,
      name: lead.name ?? lead.customer?.name ?? null,
      phone: lead.phone ?? lead.customer?.normalizedPhone ?? null,
      customer: lead.customer,
      status: lead.status,
      intent: lead.intent,
      intentScore: lead.intentScore,
      source: lead.source,
      trustStatus: lead.trustStatus,
      trustScore: lead.trustScore,
      trustReasons: lead.trustReasons,
      preferredContactChannel: lead.preferredContactChannel,
      preferredConfirmationChannel: lead.preferredConfirmationChannel,
      preferredVisitDayPart: lead.preferredVisitDayPart,
      preferredVisitTiming: lead.preferredVisitTiming,
      contactValidatedAt: lead.contactValidatedAt,
      trustAlerts: lead.trustAlerts,
      createdAt: lead.createdAt,
      updatedAt: lead.updatedAt,
      followUpAt: lead.followUpAt,
      assignedTo: lead.assignedTo,
      summary,
      interestedInventory: { projects, units },
      conversation: lead.conversation,
      notes: lead.notes.map((note) => ({
        id: note.id,
        content: note.content,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        admin: note.adminUser,
      })),
      events: lead.events.map((event) => ({
        id: event.id,
        type: event.type,
        payload: event.payload,
        createdAt: event.createdAt,
        admin: event.adminUser,
      })),
    };
  }

  async update(id: string, body: UpdateLeadDto, adminUserId: string) {
    if (
      body.status === undefined &&
      body.assignedToAdminId === undefined &&
      body.followUpAt === undefined
    )
      throw new BadRequestException("At least one lead field must be changed");
    const current = await this.prisma.lead.findUnique({
      where: { id },
      select: { status: true, assignedToAdminId: true, followUpAt: true },
    });
    if (!current) throw new NotFoundException("Lead not found");
    if (body.assignedToAdminId) {
      const admin = await this.prisma.adminUser.findFirst({
        where: { id: body.assignedToAdminId, active: true },
        select: { id: true },
      });
      if (!admin)
        throw new BadRequestException("Assigned administrator is not active");
    }
    const data: Prisma.LeadUpdateInput = {};
    if (body.status !== undefined) data.status = body.status;
    if (body.assignedToAdminId !== undefined)
      data.assignedTo = body.assignedToAdminId
        ? { connect: { id: body.assignedToAdminId } }
        : { disconnect: true };
    if (body.followUpAt !== undefined)
      data.followUpAt = body.followUpAt ? new Date(body.followUpAt) : null;
    const changes = {
      previousStatus: current.status,
      newStatus: body.status ?? current.status,
      previousAssignedToAdminId: current.assignedToAdminId,
      assignedToAdminId: body.assignedToAdminId,
      previousFollowUpAt: current.followUpAt,
      followUpAt: body.followUpAt,
    };
    const lead = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.lead.update({
        where: { id },
        data,
        select: {
          id: true,
          status: true,
          assignedToAdminId: true,
          followUpAt: true,
          updatedAt: true,
        },
      });
      await tx.leadEvent.create({
        data: {
          leadId: id,
          adminUserId,
          type:
            body.status !== undefined
              ? "STATUS_CHANGED"
              : body.assignedToAdminId !== undefined
                ? "ASSIGNMENT_CHANGED"
                : "FOLLOW_UP_CHANGED",
          payload: changes,
        },
      });
      return updated;
    });
    await this.audit.record(adminUserId, "LEAD_UPDATED", "Lead", id, changes);
    return lead;
  }

  async addNote(id: string, body: CreateLeadNoteDto, adminUserId: string) {
    const content = body.content.trim();
    if (!content) throw new BadRequestException("Note content is required");
    const exists = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Lead not found");
    const note = await this.prisma.$transaction(async (tx) => {
      const item = await tx.leadNote.create({
        data: { leadId: id, adminUserId, content },
        include: { adminUser: { select: { id: true, name: true } } },
      });
      await tx.leadEvent.create({
        data: {
          leadId: id,
          adminUserId,
          type: "NOTE_ADDED",
          payload: { noteId: item.id },
        },
      });
      await tx.lead.update({ where: { id }, data: { updatedAt: new Date() } });
      return item;
    });
    await this.audit.record(adminUserId, "LEAD_NOTE_ADDED", "Lead", id, {
      noteId: note.id,
    });
    return {
      id: note.id,
      content: note.content,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      admin: note.adminUser,
    };
  }

  async events(id: string) {
    const exists = await this.prisma.lead.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException("Lead not found");
    return this.prisma.leadEvent.findMany({
      where: { leadId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        type: true,
        payload: true,
        createdAt: true,
        adminUser: { select: { id: true, name: true } },
      },
    });
  }
  async trustAlerts(limit = 20) {
    return this.prisma.customerTrustAlert.findMany({
      where: { status: "OPEN" },
      orderBy: [{ riskLevel: "desc" }, { createdAt: "desc" }],
      take: Math.min(100, Math.max(1, limit)),
      select: {
        id: true, riskLevel: true, score: true, reasons: true, candidateName: true,
        candidatePhone: true, messagePreview: true, createdAt: true, conversationId: true,
        leadId: true,
      },
    });
  }

  async reviewTrustAlert(id: string, body: TrustAlertFeedbackDto, adminUserId: string) {
    const alert = await this.prisma.customerTrustAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException("Trust alert not found");
    const status = body.disposition;
    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.customerTrustAlert.update({
        where: { id },
        data: { status, resolvedAt: new Date(), resolvedByAdminId: adminUserId, payload: { ...(this.json(alert.payload ?? {})), adminNote: body.note ?? null } },
      });
      if (alert.leadId) {
        const trustData = status === "ADMIN_CONFIRMED_REAL"
          ? { trustStatus: status, trustScore: 100, trustReasons: [] as string[] }
          : status === "ADMIN_CONFIRMED_FAKE"
            ? { trustStatus: status, trustScore: 0, trustReasons: [...new Set([...alert.reasons, "admin_confirmed_fake"])] }
            : { trustStatus: "NEEDS_VERIFICATION", trustScore: alert.score, trustReasons: alert.reasons };
        await tx.lead.update({ where: { id: alert.leadId }, data: trustData });
        await tx.leadEvent.create({ data: { leadId: alert.leadId, adminUserId, type: "TRUST_REVIEWED", payload: { alertId: id, disposition: status, note: body.note ?? null } } });
      }
      return item;
    });
    await this.audit.record(adminUserId, "CUSTOMER_TRUST_REVIEWED", "CustomerTrustAlert", id, { disposition: status, leadId: alert.leadId, conversationId: alert.conversationId });
    return updated;
  }

  admins() {
    return this.prisma.adminUser.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    });
  }
  projects() {
    return this.prisma.project.findMany({
      where: { units: { some: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }
  async summaryCounts() {
    const now = new Date();
    const week = new Date(now);
    week.setDate(week.getDate() - 7);
    const [newLeads, highIntent, followUpsDue, thisWeek, trustAlertsOpen] =
      await this.prisma.$transaction([
        this.prisma.lead.count({ where: { status: LeadStatus.NEW } }),
        this.prisma.lead.count({
          where: {
            intentScore: { gte: 80 },
            status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
          },
        }),
        this.prisma.lead.count({
          where: {
            followUpAt: { lte: now },
            status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
          },
        }),
        this.prisma.lead.count({ where: { createdAt: { gte: week } } }),
        this.prisma.customerTrustAlert.count({ where: { status: "OPEN" } }),
      ]);
    return { newLeads, highIntent, followUpsDue, thisWeek, trustAlertsOpen };
  }

  private conversationWhere(query: { search?: string; intent?: LeadIntent }) {
    const AND: Prisma.ConversationWhereInput[] = [];
    if (query.search)
      AND.push({
        OR: [
          { title: { contains: query.search, mode: "insensitive" } },
          {
            leads: {
              some: {
                OR: [
                  { name: { contains: query.search, mode: "insensitive" } },
                  { phone: { contains: query.search } },
                  { customer: { is: { name: { contains: query.search, mode: "insensitive" } } } },
                  { customer: { is: { normalizedPhone: { contains: query.search } } } },
                ],
              },
            },
          },
        ],
      });
    if (query.intent) AND.push({ leads: { some: { intent: query.intent } } });
    return AND.length ? { AND } : {};
  }

  async conversations(query: AdminConversationListQueryDto) {
    const where: Prisma.NadimConversationWhereInput = {
      deletedAt: null,
      ...(query.search ? { OR: [
        { externalUserId: { contains: query.search, mode: "insensitive" } },
        { customer: { is: { name: { contains: query.search, mode: "insensitive" } } } },
        { propertyRequirements: { some: { title: { contains: query.search, mode: "insensitive" } } } },
      ] } : {}),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.nadimConversation.count({ where }),
      this.prisma.nadimConversation.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          channel: true,
          locale: true,
          mode: true,
          externalUserId: true,
          createdAt: true,
          updatedAt: true,
          customer: { select: { name: true } },
          activeRequirement: { select: { title: true, status: true, propertyType: true, locations: true, bedrooms: true, budgetMax: true, currency: true } },
          propertyRequirements: { where: { status: { not: "CLOSED" } }, orderBy: { updatedAt: "desc" }, take: 3, select: { title: true, status: true } },
          _count: { select: { turns: true, participants: { where: { status: "ACTIVE" } }, followUpTasks: { where: { status: "PENDING" } } } },
        },
      }),
    ]);
    return {
      items: items.map((item) => ({ ...item, identity: item.customer?.name ?? this.maskIdentity(item.externalUserId) ?? "عميل بدون اسم", externalUserId: undefined, customer: undefined })),
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }

  async exportConversations(
    query: AdminConversationExportQueryDto,
    adminUserId: string,
  ) {
    const where: Prisma.NadimConversationWhereInput = { deletedAt: null, ...(query.search ? { OR: [{ externalUserId: { contains: query.search, mode: "insensitive" } }, { customer: { is: { name: { contains: query.search, mode: "insensitive" } } } }, { propertyRequirements: { some: { title: { contains: query.search, mode: "insensitive" } } } }] } : {}) };
    const total = await this.prisma.nadimConversation.count({ where });
    if (total > LeadCrmService.MAX_CONVERSATION_EXPORT) {
      throw new BadRequestException(
        `Conversation export is limited to ${LeadCrmService.MAX_CONVERSATION_EXPORT.toLocaleString("en-US")} records. Narrow the search and try again.`,
      );
    }
    const records = await this.prisma.nadimConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        locale: true,
        summary: true,
        state: true,
        externalUserId: true,
        customer: { select: { name: true } },
        createdAt: true,
        updatedAt: true,
        turns: {
          orderBy: { createdAt: "asc" },
          select: { id: true, userMessage: true, assistantReply: true, createdAt: true },
        },
      },
    });
    const exportRecords = records.map((record) => ({
      id: record.id,
      title: record.customer?.name ?? this.maskIdentity(record.externalUserId) ?? "Conversation",
      detectedLanguage: record.locale,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      state: { summary: record.summary, searchContext: record.state, intentScore: 0 },
      leads: [],
      messages: record.turns.flatMap((turn) => [
        { id: `${turn.id}:user`, role: "USER", content: turn.userMessage, createdAt: turn.createdAt },
        ...(turn.assistantReply ? [{ id: `${turn.id}:assistant`, role: "ASSISTANT", content: turn.assistantReply, createdAt: turn.createdAt }] : []),
      ]),
    }));
    const file = createConversationExport(exportRecords, query.format, {
      ...(query.search ? { search: query.search } : {}),
      ...(query.intent ? { intent: query.intent } : {}),
    });
    await this.audit.record(
      adminUserId,
      "CONVERSATIONS_EXPORTED",
      "Conversation",
      undefined,
      {
        format: query.format,
        count: records.length,
        filters: { searchApplied: Boolean(query.search), intent: query.intent },
      },
    );
    return file;
  }
  async conversation(id: string) {
    const item = await this.prisma.nadimConversation.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        channel: true,
        locale: true,
        timezone: true,
        mode: true,
        activeRequirementId: true,
        customerContext: true,
        summary: true,
        externalUserId: true,
        createdAt: true,
        updatedAt: true,
        customer: { select: { name: true } },
        turns: {
          orderBy: { createdAt: "asc" },
          select: { id: true, channel: true, userMessage: true, assistantReply: true, modelProvider: true, createdAt: true },
        },
        propertyRequirements: { orderBy: { updatedAt: "desc" }, select: { id: true, title: true, status: true, purpose: true, propertyType: true, locations: true, preferredDevelopers: true, preferredProjects: true, bedrooms: true, bathrooms: true, areaMin: true, areaMax: true, budgetMin: true, budgetMax: true, currency: true, updatedAt: true } },
        followUpTasks: { where: { status: { in: ["PENDING", "CLAIMED"] } }, orderBy: { dueAt: "asc" }, select: { id: true, dueAt: true, timezone: true, status: true, reason: true, channel: true } },
        participants: { orderBy: { joinedAt: "asc" }, select: { id: true, channel: true, role: true, status: true, joinedAt: true, externalUserId: true } },
      },
    });
    if (!item) throw new NotFoundException("Conversation not found");
    return {
      ...item,
      identity: item.customer?.name ?? this.maskIdentity(item.externalUserId) ?? "عميل بدون اسم",
      externalUserId: undefined,
      customer: undefined,
      messages: item.turns.flatMap((turn) => [
        ...(turn.userMessage ? [{ id: `${turn.id}:user`, role: "USER", content: turn.userMessage, channel: turn.channel, createdAt: turn.createdAt }] : []),
        ...(turn.assistantReply ? [{ id: `${turn.id}:assistant`, role: turn.modelProvider === "HUMAN" ? "HUMAN" : "ASSISTANT", content: turn.assistantReply, channel: turn.channel, createdAt: turn.createdAt }] : []),
      ]),
      turns: undefined,
      propertyRequirements: item.propertyRequirements.map((requirement) => ({ ...requirement, active: requirement.id === item.activeRequirementId })),
      participants: item.participants.map((participant) => ({ ...participant, externalUserId: this.maskIdentity(participant.externalUserId) })),
    };
  }

  async setConversationMode(id: string, mode: "AI" | "HUMAN" | "PAUSED", adminUserId: string) {
    const current = await this.prisma.nadimConversation.findFirst({ where: { id, deletedAt: null }, select: { mode: true } });
    if (!current) throw new NotFoundException("Conversation not found");
    const now = new Date();
    const item = await this.prisma.nadimConversation.update({ where: { id }, data: { mode, modeChangedAt: now, humanModeSince: mode === "HUMAN" ? now : null, lastHumanMessageAt: mode === "HUMAN" ? now : null } });
    await this.audit.record(adminUserId, "NADIM_CONVERSATION_MODE_CHANGED", "NadimConversation", id, { previousMode: current.mode, mode });
    return { id: item.id, mode: item.mode, updatedAt: item.updatedAt };
  }

  async createConversationLink(id: string, type: "WEB_SHARE" | "WHATSAPP_HANDOFF", adminUserId: string) {
    if (!this.lifecycle) throw new BadRequestException("Conversation lifecycle is unavailable");
    const created = await this.lifecycle.createToken({ conversationId: id, type, maxUses: type === "WHATSAPP_HANDOFF" ? 1 : undefined });
    const base = process.env.WEB_BASE_URL?.replace(/\/$/u, "");
    const number = process.env.WHATSAPP_BUSINESS_NUMBER?.replace(/\D/gu, "");
    const url = type === "WEB_SHARE" && base ? `${base}/c/${encodeURIComponent(created.token)}` : type === "WHATSAPP_HANDOFF" && number ? `https://wa.me/${number}?text=${encodeURIComponent(`continue ${created.token}`)}` : undefined;
    if (!url) { await this.lifecycle.revokeToken(created.id, id); throw new BadRequestException(type === "WEB_SHARE" ? "WEB_BASE_URL is not configured" : "WHATSAPP_BUSINESS_NUMBER is not configured"); }
    await this.audit.record(adminUserId, "NADIM_CONVERSATION_LINK_CREATED", "NadimConversation", id, { type });
    return { tokenId: created.id, url, expiresAt: created.expiresAt };
  }

  async sendHumanMessage(id: string, rawContent: string, adminUserId: string) {
    const content = rawContent.trim();
    if (!content) throw new BadRequestException("Message content is required");
    const conversation = await this.prisma.nadimConversation.findFirst({
      where: { id, deletedAt: null }, select: { id: true, mode: true, webConversations: { select: { id: true } } },
    });
    if (!conversation) throw new NotFoundException("Conversation not found");
    if (conversation.mode !== "HUMAN") throw new BadRequestException("Conversation must be in HUMAN mode before a human reply is sent");
    const now = new Date();
    const turnId = `human_${randomUUID()}`;
    await this.prisma.$transaction([
      this.prisma.nadimTurn.create({ data: {
        id: turnId, conversationId: id, channel: "WEB", userMessage: "", assistantReply: content,
        intent: { type: "HUMAN_MESSAGE", adminUserId }, plan: { goal: "HUMAN_REPLY", steps: [] },
        toolResults: [], proposedActions: [], executedActions: [], modelProvider: "HUMAN", model: "DASHBOARD_AGENT",
        fallbackUsed: false, success: true, latencyMs: 0, createdAt: now,
      } }),
      this.prisma.message.createMany({ data: conversation.webConversations.map((binding) => ({
        id: `human_${binding.id}_${turnId}`, conversationId: binding.id, role: "ASSISTANT" as const, content,
        toolPayload: { type: "human_message", author: "HUMAN" }, createdAt: now,
      })), skipDuplicates: true }),
      this.prisma.nadimConversation.update({ where: { id }, data: { lastHumanMessageAt: now } }),
    ]);
    await this.audit.record(adminUserId, "NADIM_HUMAN_MESSAGE_SENT", "NadimConversation", id);
    return { id: `${turnId}:assistant`, role: "HUMAN", content, channel: "WEB", createdAt: now };
  }

  async deleteConversation(id: string, confirmation: "DELETE", adminUserId: string) {
    if (confirmation !== "DELETE") throw new BadRequestException("Deletion confirmation is required");
    const changed = await this.prisma.nadimConversation.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date(), mode: "PAUSED" } });
    if (!changed.count) throw new NotFoundException("Conversation not found");
    await this.prisma.followUpTask.updateMany({ where: { conversationId: id, status: { in: ["PENDING", "CLAIMED"] } }, data: { status: "CANCELLED", claimedAt: null, claimedBy: null } });
    await this.audit.record(adminUserId, "NADIM_CONVERSATION_DELETED", "NadimConversation", id);
    return { deleted: true };
  }

  private maskIdentity(value?: string | null) {
    if (!value) return undefined;
    if (value.includes("@")) { const [local, domain] = value.split("@"); return `${local.slice(0, 2)}***@${domain}`; }
    const digits = value.replace(/\D/gu, "");
    return digits.length >= 7 ? `${digits.slice(0, 3)}••••${digits.slice(-3)}` : `${value.slice(0, 2)}•••`;
  }
}
