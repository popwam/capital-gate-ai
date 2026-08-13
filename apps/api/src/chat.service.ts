import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ApprovalStatus,
  DocumentType,
  LeadStatus,
  MessageRole,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { ConversationsService } from "./conversations.service";
import {
  AIMessage,
  AIProvider,
  AnswerInput,
  StructuredIntent,
} from "./providers/ai-provider";
import { PropertySearchService } from "./property-search.service";
import { MapsService } from "./maps.service";

type MessagePayload = {
  type:
    | "text"
    | "properties"
    | "media"
    | "documents"
    | "map"
    | "lead_prompt"
    | "lead_created";
  properties?: unknown[];
  media?: unknown[];
  documents?: unknown[];
  map?: unknown;
  leadId?: string;
};
type Prepared = {
  conversationId: string;
  answerInput: AnswerInput;
  state: StructuredIntent;
  payload: MessagePayload;
  userMessages: AIMessage[];
  unitIds: string[];
  trace: Record<string, unknown>;
};
export function leadPersistenceAction(
  existingLeadId: string | undefined,
  phone: string | undefined,
  intentScore = 0,
): "update" | "create" | "none" {
  if (!phone) return "none";
  if (existingLeadId) return "update";
  return intentScore >= 70 ? "create" : "none";
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  constructor(
    @Inject("AI_PROVIDER") private readonly ai: AIProvider,
    private readonly prisma: PrismaService,
    private readonly conversations: ConversationsService,
    private readonly search: PropertySearchService,
    private readonly maps: MapsService,
  ) {}

  private serialize(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  async prepare(
    conversationId: string,
    rawToken: string,
    content: string,
    requestId = "unknown",
  ): Promise<Prepared> {
    const startedAt = Date.now();
    const { conversation } = await this.conversations.assertOwned(
      conversationId,
      rawToken,
    );
    await this.prisma.message.create({
      data: { conversationId, role: MessageRole.USER, content },
    });
    const [history, existingState] = await Promise.all([
      this.prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: "desc" },
        take: 20,
      }),
      this.prisma.conversationState.findUnique({ where: { conversationId } }),
    ]);
    const messages: AIMessage[] = history.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? "user" : "assistant",
      content: m.content,
    }));
    const previous =
      (existingState?.searchContext as StructuredIntent | null) ?? {
        language: conversation.detectedLanguage ?? "ar-EG",
      };
    const state = await this.ai.extractIntent(messages, previous, { requestId, conversationId });
    const trace: Record<string, unknown> = {
      requestId,
      conversationId,
      inputLanguage: state.language,
      extractedIntent: state.temporaryIntent ?? "PROPERTY_SEARCH",
      aggregationDimension: state.aggregationDimension ?? null,
      previousConversationState: this.safeTraceState(previous),
      newConversationState: this.safeTraceState(state),
      extractionDegraded: Boolean(state.extractionDegraded),
    };
    let properties: any[] = [];
    let payload: MessagePayload = { type: "text" };
    let verifiedFacts: unknown[] = [];
    let approvedKnowledge: unknown[] = [];
    const priorUnitIds = existingState?.suggestedUnitIds ?? [];

    if (state.requestedMedia) {
      let projectId: string | undefined;
      if (state.requestedProject)
        projectId = (
          await this.prisma.project.findFirst({
            where: {
              name: { contains: state.requestedProject, mode: "insensitive" },
            },
            select: { id: true },
          })
        )?.id;
      if (!projectId && priorUnitIds.length)
        projectId = (
          await this.prisma.unit.findFirst({
            where: { id: { in: priorUnitIds } },
            select: { projectId: true },
          })
        )?.projectId;
      if (projectId && state.requestedMedia === "IMAGES") {
        const media = await this.search.getProjectMedia(projectId);
        payload = { type: "media", media: this.serialize(media) };
        verifiedFacts = media;
      }
      if (projectId && state.requestedMedia === "BROCHURE") {
        const documents = await this.search.getProjectDocuments(
          projectId,
          DocumentType.BROCHURE,
        );
        payload = { type: "documents", documents: this.serialize(documents) };
        verifiedFacts = documents;
      }
      if (projectId && state.requestedMedia === "MAP") {
        const project = await this.search.getProject(projectId);
        const map =
          project.latitude && project.longitude
            ? {
                latitude: project.latitude,
                longitude: project.longitude,
                url: `https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`,
              }
            : project.location?.latitude && project.location?.longitude
              ? {
                  latitude: project.location.latitude,
                  longitude: project.location.longitude,
                  url: `https://www.google.com/maps/search/?api=1&query=${project.location.latitude},${project.location.longitude}`,
                }
              : null;
        payload = { type: "map", map: this.serialize(map) };
        verifiedFacts = map ? [map] : [];
      }
    } else if (state.preferredDevelopers?.length === 1 && /(?:المطور|سابقة|سلم|تاريخ|developer|track\s*record|portfolio)/iu.test(content)) {
      const developerName = state.preferredDevelopers[0];
      const developer = await this.prisma.developer.findFirst({ where: { OR: [{ name: { contains: developerName, mode: "insensitive" } }, { canonicalName: { contains: developerName, mode: "insensitive" } }, { nameAr: { contains: developerName, mode: "insensitive" } }, { nameEn: { contains: developerName, mode: "insensitive" } }] }, select: { id: true } });
      if (developer) verifiedFacts = [this.serialize(await this.search.getDeveloper(developer.id))];
      trace.searchOperation = "GET_DEVELOPER_STRUCTURED_FACTS";
      trace.databaseResultCount = developer ? 1 : 0;
    } else if (state.requestedProject) {
      const match = await this.search.findProjectByName(state.requestedProject);
      if (match) {
        const project = await this.search.getProject(match.id);
        verifiedFacts = [this.serialize(project)];
        approvedKnowledge = project.knowledgeItems;
        trace.searchOperation = "GET_PROJECT_STRUCTURED_FACTS";
        trace.databaseResultCount = 1;
      } else {
        trace.searchOperation = "GET_PROJECT_STRUCTURED_FACTS";
        trace.databaseResultCount = 0;
      }
    } else if (state.temporaryIntent === "INVENTORY_AGGREGATION" && state.aggregationDimension) {
      const aggregate = await this.search.aggregateInventory(state);
      verifiedFacts = [this.serialize(aggregate)];
      trace.searchOperation = `AGGREGATE_${state.aggregationDimension}`;
      trace.databaseResultCount = aggregate.count;
      trace.aggregateQuery = { dimension: state.aggregationDimension };
    } else {
      properties = await this.search.searchProperties(state);
      verifiedFacts = this.serialize(properties);
      const originIds = await this.search.resolveLocations(state.locations);
      if (originIds.length) {
        const distances = await this.search.findNearbyLocations(
          originIds,
          state.maxTravelMinutes,
        );
        verifiedFacts = [...verifiedFacts, ...this.serialize(distances)];
      }
      if (properties.length) {
        payload = {
          type: "properties",
          properties: verifiedFacts as unknown[],
        };
        const projectIds = [...new Set(properties.map((p) => p.projectId))];
        approvedKnowledge = await this.prisma.projectKnowledgeItem.findMany({
          where: {
            projectId: { in: projectIds },
            approvalStatus: ApprovalStatus.APPROVED,
          },
          select: {
            projectId: true,
            category: true,
            content: true,
            sourceText: true,
          },
        });
      }
    }
    trace.normalizedSearchFilters = await this.search.normalizedSearchFilters(state);
    trace.searchOperation ??= "SEARCH_PROPERTIES";
    trace.databaseResultCount ??= properties.length;

    if (
      state.exactRouteRequested &&
      state.routeOrigin &&
      state.routeDestination
    ) {
      const [origins, destinations] = await Promise.all([
        this.search.resolveLocations([state.routeOrigin]),
        this.search.resolveLocations([state.routeDestination]),
      ]);
      const stored =
        origins.length && destinations.length
          ? await this.prisma.locationDistance.findFirst({
              where: {
                fromLocationId: { in: origins },
                toLocationId: { in: destinations },
                verifiedAt: { not: null },
              },
              include: { from: true, to: true },
            })
          : null;
      const route = stored
        ? {
            source: "ADMIN_VERIFIED",
            distanceKm: stored.distanceKm,
            estimatedMinutes: stored.estimatedMinutes,
            from: stored.from.name,
            to: stored.to.name,
            notes: stored.notes,
          }
        : process.env.GOOGLE_MAPS_SERVER_API_KEY
          ? {
              source: "GOOGLE_ROUTES",
              ...((await this.maps.route(
                state.routeOrigin,
                state.routeDestination,
              )) as object),
            }
          : { source: "UNAVAILABLE" };
      verifiedFacts = [...verifiedFacts, this.serialize(route)];
      payload = {
        ...payload,
        map: {
          ...((payload.map as object) || {}),
          route: this.serialize(route),
        },
      };
    }

    const unitIds = properties.map((p) => p.id);
    if ((state.purchaseIntent ?? 0) >= 80 && !state.contactPhone)
      payload = { ...payload, type: "lead_prompt" };
    if (state.contactPhone) {
      const existingLead = await this.prisma.lead.findFirst({
        where: {
          conversationId,
          status: { notIn: [LeadStatus.WON, LeadStatus.LOST] },
        },
        orderBy: { createdAt: "desc" },
      });
      const persistence = leadPersistenceAction(
        existingLead?.id,
        state.contactPhone,
        state.purchaseIntent ?? 0,
      );
      if (persistence === "none")
        return this.finishPreparation(
          conversationId,
          conversation.detectedLanguage,
          state,
          payload,
          messages,
          properties,
          verifiedFacts,
          approvedKnowledge,
          trace,
          startedAt,
        );
      const interestedUnits = [...new Set([...priorUnitIds, ...unitIds])];
      const interestedProjects = interestedUnits.length
        ? (
            await this.prisma.unit.findMany({
              where: { id: { in: interestedUnits } },
              select: { projectId: true },
            })
          ).map((item) => item.projectId)
        : [];
      const conversationSummary = {
        customerGoal: state.purpose,
        budget: {
          min: state.budgetMin,
          max: state.budgetMax,
          currency: state.currency,
        },
        preferredLocations: state.locations ?? [],
        propertyTypes: state.propertyTypes ?? [],
        bedrooms: state.bedrooms,
        hardRequirements: state.hardRequirements ?? [],
        softPreferences: state.softPreferences ?? [],
        intentScore: state.purchaseIntent ?? 80,
        recentConversation: messages.slice(-8),
      };
      const leadPayload = this.serialize({
        requirements: state,
        interestedUnits,
        interestedProjects: [...new Set(interestedProjects)],
        conversationSummary,
      });
      const lead =
        persistence === "update" && existingLead
          ? await this.prisma.lead.update({
              where: { id: existingLead.id },
              data: {
                name: state.contactName || existingLead.name,
                phone: state.contactPhone,
                intentScore: state.purchaseIntent ?? existingLead.intentScore,
                payload: leadPayload,
                events: {
                  create: { type: "LEAD_UPDATED", payload: { channel: "WEB" } },
                },
              },
            })
          : await this.prisma.lead.create({
              data: {
                conversationId,
                name: state.contactName || "Anonymous customer",
                phone: state.contactPhone,
                intent: "PURCHASE",
                intentScore: state.purchaseIntent ?? 80,
                payload: leadPayload,
                source: "WEB_AI",
                events: {
                  create: { type: "LEAD_CREATED", payload: { channel: "WEB" } },
                },
              },
            });
      await this.prisma.conversationState.upsert({
        where: { conversationId },
        create: {
          conversationId,
          searchContext: this.serialize(state),
          suggestedUnitIds: interestedUnits,
          rejectedUnitIds: [],
          likedUnitIds: [],
          intentScore: state.purchaseIntent ?? 80,
          summary: this.serialize(conversationSummary),
        },
        update: { summary: this.serialize(conversationSummary) },
      });
      payload = { type: "lead_created", leadId: lead.id };
    }

    return this.finishPreparation(
      conversationId,
      conversation.detectedLanguage,
      state,
      payload,
      messages,
      properties,
      verifiedFacts,
      approvedKnowledge,
      trace,
      startedAt,
    );
  }

  private async finishPreparation(
    conversationId: string,
    previousLanguage: string | null,
    state: StructuredIntent,
    payload: MessagePayload,
    messages: AIMessage[],
    properties: any[],
    verifiedFacts: unknown[],
    approvedKnowledge: unknown[],
    trace: Record<string, unknown>,
    startedAt: number,
  ): Promise<Prepared> {
    const unitIds = properties.map((property) => property.id);
    await this.prisma.$transaction([
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          detectedLanguage: state.language || previousLanguage,
          updatedAt: new Date(),
        },
      }),
      this.prisma.conversationState.upsert({
        where: { conversationId },
        create: {
          conversationId,
          searchContext: this.serialize(state),
          suggestedUnitIds: unitIds,
          rejectedUnitIds: [],
          likedUnitIds: [],
          intentScore: state.purchaseIntent ?? 0,
        },
        update: {
          searchContext: this.serialize(state),
          suggestedUnitIds: unitIds.length ? unitIds : undefined,
          intentScore: state.purchaseIntent ?? 0,
        },
      }),
    ]);
    return {
      conversationId,
      answerInput: {
        messages,
        intent: state,
        verifiedFacts,
        approvedKnowledge,
        requestId: String(trace.requestId ?? "unknown"),
        conversationId,
      },
      state,
      payload,
      userMessages: messages,
      unitIds,
      trace: { ...trace, latencyMs: Date.now() - startedAt },
    };
  }

  async send(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    const answer = await this.ai.composeAnswer(prepared.answerInput);
    const message = await this.persistAssistant(prepared, answer);
    this.logTrace(prepared, { finalResponseProvider: "HYBRID", completed: true });
    return { message, state: prepared.state, ...prepared.payload };
  }

  async *stream(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    let answer = "";
    try {
      for await (const chunk of this.ai.streamAnswer(prepared.answerInput)) {
        answer += chunk;
        yield { event: "token", data: { text: chunk } };
      }
      const message = await this.persistAssistant(prepared, answer);
      this.logTrace(prepared, { finalResponseProvider: "HYBRID_STREAM", completed: true });
      yield { event: "complete", data: { message, state: prepared.state, ...prepared.payload } };
    } catch (error) {
      this.logTrace(prepared, { finalResponseProvider: "HYBRID_STREAM", completed: false, errorCategory: this.errorCategory(error) });
      throw error;
    }
  }

  private safeTraceState(state: StructuredIntent) {
    const { contactName: _contactName, contactPhone: _contactPhone, ...safe } = state;
    return safe;
  }
  private errorCategory(error: unknown) {
    const response = typeof (error as any)?.getResponse === "function" ? (error as any).getResponse() : undefined;
    return response?.category ?? response?.code ?? (error as any)?.code ?? "UNKNOWN";
  }
  private logTrace(prepared: Prepared, completion: Record<string, unknown>) {
    this.logger.log(`CustomerTurnTrace ${JSON.stringify({ ...prepared.trace, ...completion })}`);
  }

  private persistAssistant(prepared: Prepared, answer: string) {
    return this.prisma.message.create({
      data: {
        conversationId: prepared.conversationId,
        role: MessageRole.ASSISTANT,
        content: answer,
        toolPayload: this.serialize(prepared.payload) as Prisma.InputJsonValue,
      },
    });
  }
}
