import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { LeadStatus, Prisma } from "@prisma/client";
import { AuditService } from "../audit.service";
import { PrismaService } from "../database/prisma.service";
import {
  AdminConversationListQueryDto,
  CreateLeadNoteDto,
  LeadListQueryDto,
  UpdateLeadDto,
} from "./lead-crm.dto";

type JsonObject = Record<string, any>;

@Injectable()
export class LeadCrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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
    const budget = this.json(summary.budget ?? {});
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
      interestedProjectIds: Array.isArray(data.interestedProjects)
        ? data.interestedProjects
        : [],
      interestedUnitIds: Array.isArray(data.interestedUnits)
        ? data.interestedUnits
        : [],
      conversationSummary: summary,
    };
  }

  private async where(query: LeadListQueryDto): Promise<Prisma.LeadWhereInput> {
    const AND: Prisma.LeadWhereInput[] = [];
    if (query.status) AND.push({ status: query.status });
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
          name: lead.name,
          phone: lead.phone,
          status: lead.status,
          intent: lead.intent,
          intentScore: lead.intentScore,
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
          status: true,
          project: { select: { id: true, name: true } },
        },
      }),
      this.prisma.project.findMany({
        where: { id: { in: summary.interestedProjectIds } },
        select: { id: true, name: true, developer: { select: { name: true } } },
      }),
    ]);
    return {
      id: lead.id,
      name: lead.name,
      phone: lead.phone,
      status: lead.status,
      intent: lead.intent,
      intentScore: lead.intentScore,
      source: lead.source,
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
    const [newLeads, highIntent, followUpsDue, thisWeek] =
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
      ]);
    return { newLeads, highIntent, followUpsDue, thisWeek };
  }

  async conversations(query: AdminConversationListQueryDto) {
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
                ],
              },
            },
          },
        ],
      });
    if (query.intent) AND.push({ leads: { some: { intent: query.intent } } });
    const where: Prisma.ConversationWhereInput = AND.length ? { AND } : {};
    const [total, items] = await this.prisma.$transaction([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          title: true,
          detectedLanguage: true,
          createdAt: true,
          updatedAt: true,
          _count: { select: { messages: true, leads: true } },
          leads: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { id: true, name: true, status: true, intentScore: true },
          },
        },
      }),
    ]);
    return {
      items,
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    };
  }
  async conversation(id: string) {
    const item = await this.prisma.conversation.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        detectedLanguage: true,
        createdAt: true,
        updatedAt: true,
        state: {
          select: { summary: true, searchContext: true, intentScore: true },
        },
        leads: {
          select: { id: true, name: true, status: true, intentScore: true },
        },
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });
    if (!item) throw new NotFoundException("Conversation not found");
    return item;
  }
}
