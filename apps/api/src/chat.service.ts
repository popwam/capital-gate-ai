import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  DocumentType,
  LeadStatus,
  MessageRole,
  Prisma,
} from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { ConversationsService } from "./conversations.service";
import {
  AIMessage,
  AIContextKind,
  AIProvider,
  AnswerInput,
  StructuredIntent,
} from "./providers/ai-provider";
import { answerContextMetrics, compactAnswerInput } from "./providers/ai-context";
import { PropertySearchService } from "./property-search.service";
import { MapsService } from "./maps.service";
import { deterministicIntent } from "./providers/deterministic-intent";
import { normalizeRealEstateSemantics } from "./providers/real-estate-semantics";
import { applyDeterministicTurnSemantics, nextPresentation, planCustomerTurn, UIAction, unpresentedUnitIds } from "./customer-turn-planner";
import { ApplicationCache } from "./cache/application-cache";

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
  uiActions: UIAction[];
};
type Prepared = {
  conversationId: string;
  answerInput: AnswerInput;
  state: StructuredIntent;
  payload: MessagePayload;
  userMessages: AIMessage[];
  unitIds: string[];
  trace: Record<string, unknown>;
  directAnswer?: string;
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
    private readonly cache: ApplicationCache,
  ) {}

  private serialize(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  private cardProperty(value: any) {
    return {
      id: value.id, externalUnitId: value.externalUnitId, unitType: value.unitType,
      bedrooms: value.bedrooms, bathrooms: value.bathrooms, builtUpArea: value.builtUpArea,
      price: value.price, currency: value.currency, status: value.status,
      availabilityUpdatedAt: value.availabilityUpdatedAt, deliveryDate: value.deliveryDate,
      finishingType: value.finishingType,
      project: value.project ? { id: value.project.id, name: value.project.name, location: value.project.location ? { id: value.project.location.id, name: value.project.location.name } : null } : null,
      developer: value.developer ? { id: value.developer.id, name: value.developer.name } : null,
    };
  }

  private distanceDestination(content: string) {
    if (/\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content)) return "American University in Cairo, New Cairo";
    const match = content.match(/(?:وبين|الى|إلى|to)\s+(.+?)(?:\s+(?:كام|قد ايه|how far)|[؟?]|$)/iu);
    return match?.[1]?.trim();
  }

  private projectReference(content: string, intent?: string) {
    const patterns = intent === "MEDIA_REQUEST"
      ? [/(?:photos?|images?)\s+(?:of\s+)?(.+)$/iu, /(?:صور)\s+(.+)$/u]
      : intent === "LOCATION_REQUEST"
        ? [/(?:location\s+of|where\s+is)\s+(.+)$/iu, /(?:فين|موقع)\s+(.+)$/u]
        : intent === "BROCHURE_REQUEST"
          ? [/(?:brochure\s+(?:of|for)?|بروشور)\s+(.+)$/iu]
          : [];
    for (const pattern of patterns) { const match = content.match(pattern); if (match?.[1]) return match[1].replace(/\s+بالظبط[؟?]*$/u, "").replace(/[؟?]+$/, "").trim(); }
    return undefined;
  }

  private directToolAnswer(state: StructuredIntent, payload: MessagePayload, facts: unknown[]) {
    const ar = state.language?.startsWith("ar");
    const intent = state.turnIntent;
    const first = facts[0] as any;
    if (intent === "MEDIA_REQUEST") {
      const action = payload.uiActions.find((item) => item.type === "PROJECT_PHOTOS");
      const count = (action?.payload.media as unknown[] | undefined)?.length ?? 0;
      return count ? (ar ? "أكيد، دي الصور المعتمدة المتاحة للمشروع." : "Here are the approved project photos available.") : (ar ? "لسه مفيش صور معتمدة للمشروع عندي." : "There are no approved project photos available yet.");
    }
    if (intent === "BROCHURE_REQUEST") {
      const exists = facts.length > 0;
      const sent = payload.uiActions.some((item) => item.type === "PROJECT_BROCHURE");
      return !exists ? (ar ? "لسه مفيش بروشور معتمد للمشروع عندي." : "There is no approved brochure available yet.") : sent ? (ar ? "تمام، ده البروشور المعتمد للمشروع." : "Here is the approved project brochure.") : (ar ? "أيوه، البروشور موجود. تحب أبعتهولك؟" : "Yes, the brochure is available. Would you like me to send it?");
    }
    if (intent === "LOCATION_REQUEST") return first ? (ar ? "أكيد، ده الموقع الموثق للمشروع." : "Here is the verified project location.") : (ar ? "لسه مفيش إحداثيات موثقة للمشروع عندي." : "Verified project coordinates are not available yet.");
    if (intent === "DISTANCE_REQUEST") {
      const route = first;
      if (!route || route.source === "UNAVAILABLE") return ar ? "مقدرتش أحدد مسافة موثقة للمسار ده حاليًا." : "I could not determine a verified route for that trip right now.";
      const distance = route.distanceKm ?? (route.routes?.[0]?.distanceMeters != null ? Number(route.routes[0].distanceMeters) / 1000 : null);
      const duration = route.estimatedMinutes ?? (typeof route.routes?.[0]?.duration === "string" ? Math.round(Number.parseFloat(route.routes[0].duration) / 60) : null);
      return ar ? `المسافة ${distance != null ? `حوالي ${Number(distance).toFixed(1)} كم` : "متاحة في نتيجة المسار"}${duration != null ? `، والوقت التقريبي ${duration} دقيقة` : ""}. المصدر: ${route.source === "ADMIN_VERIFIED" ? "بيانات إدارية موثقة" : "Google Routes"}.` : `The route is ${distance != null ? `about ${Number(distance).toFixed(1)} km` : "available"}${duration != null ? ` and approximately ${duration} minutes` : ""}. Source: ${route.source === "ADMIN_VERIFIED" ? "admin-verified data" : "Google Routes"}.`;
    }
    if (["INVENTORY_COUNT", "AREA_AGGREGATION", "PRICE_AGGREGATION"].includes(intent ?? "")) {
      if (intent === "INVENTORY_COUNT") return ar ? `عندي ${first?.count ?? 0} وحدة متاحة في نطاق البحث الحالي.` : `${first?.count ?? 0} units are available in the current search scope.`;
      const values = Array.isArray(first?.values) ? first.values : [];
      if (!values.length) return ar ? "مفيش بيانات مطابقة في نطاق البحث الحالي." : "No matching data is available in the current search scope.";
      if (intent === "AREA_AGGREGATION") return ar ? `المساحات المتاحة حاليًا من ${Math.min(...values.map(Number))} إلى ${Math.max(...values.map(Number))} م².` : `Available areas currently range from ${Math.min(...values.map(Number))} to ${Math.max(...values.map(Number))} m².`;
      const prices = values.map((item: any) => Number(item.price)).filter(Number.isFinite);
      return ar ? `الأسعار المتاحة حاليًا من ${Math.min(...prices).toLocaleString("en")} إلى ${Math.max(...prices).toLocaleString("en")} EGP.` : `Available prices currently range from EGP ${Math.min(...prices).toLocaleString("en")} to ${Math.max(...prices).toLocaleString("en")}.`;
    }
    if (intent === "VIEWING_REQUEST" && state.externalUnitId) return facts.length ? (ar ? `تمام، لقيت الوحدة ${state.externalUnitId}. عشان نرتب المعاينة محتاج اسمك ورقم الموبايل.` : `I found unit ${state.externalUnitId}. To arrange the viewing, I need your name and phone number.`) : (ar ? `ملقيتش وحدة متاحة بالكود ${state.externalUnitId}.` : `I could not find an available unit with ID ${state.externalUnitId}.`);
    return undefined;
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
    const plan = planCustomerTurn(content, previous);
    const extracted = plan.requiresExtraction
      ? await this.ai.extractIntent(messages, previous, { requestId, conversationId })
      : normalizeRealEstateSemantics(content, deterministicIntent(messages, previous), previous);
    const state = applyDeterministicTurnSemantics(content, extracted, previous, plan);
    const trace: Record<string, unknown> = {
      requestId,
      conversationId,
      inputLanguage: state.language,
      extractedIntent: plan.intent,
      aggregationDimension: state.aggregationDimension ?? null,
      previousConversationState: this.safeTraceState(previous),
      newConversationState: this.safeTraceState(state),
      extractionDegraded: Boolean(state.extractionDegraded),
    };
    let properties: any[] = [];
    let payload: MessagePayload = { type: "text", uiActions: [] };
    let verifiedFacts: unknown[] = [];
    let approvedKnowledge: unknown[] = [];
    let contextKind: AIContextKind = "PROPERTY_SEARCH";
    const priorUnitIds = existingState?.suggestedUnitIds ?? [];
    const priorPresentation = previous.presentation ?? {};
    let cacheHits = this.cache.stats().hits;
    let cacheMisses = this.cache.stats().misses;

    let projectId = priorPresentation.selectedProjectId;
    const referencedProject = state.requestedProject ?? this.projectReference(content, plan.intent);
    if (referencedProject) projectId = (await this.search.findProjectByName(referencedProject))?.id ?? projectId;
    if (!projectId && priorPresentation.selectedUnitId)
      projectId = (await this.prisma.unit.findUnique({ where: { id: priorPresentation.selectedUnitId }, select: { projectId: true } }))?.projectId;
    if (!projectId && priorUnitIds.length)
      projectId = (await this.prisma.unit.findFirst({ where: { id: { in: priorUnitIds } }, select: { projectId: true } }))?.projectId;

    if (plan.intent === "SMALL_TALK") {
      trace.searchOperation = "NONE";
      trace.databaseResultCount = 0;
    } else if (plan.intent === "CONTACT_REQUEST") {
      trace.searchOperation = "NONE";
      trace.databaseResultCount = 0;
    } else if (["VIEWING_REQUEST", "PROPERTY_DETAILS"].includes(plan.intent) && plan.exactUnitId) {
      const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
      trace.searchOperation = "EXACT_UNIT_LOOKUP";
      trace.databaseResultCount = unit ? 1 : 0;
      if (unit) {
        properties = [unit]; verifiedFacts = this.serialize(properties); projectId = unit.projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: unit.id, selectedProjectId: unit.projectId, lastReferencedEntity: { type: "UNIT", id: unit.id }, ...(plan.intent === "VIEWING_REQUEST" ? { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), unit.id])], lastPresentedUnitIds: [unit.id] } : {}), awaitingConfirmation: false });
        if (plan.intent === "VIEWING_REQUEST") payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: [this.cardProperty(unit)] } }, { type: "VIEWING_REQUEST", payload: { unitId: unit.id, externalUnitId: unit.externalUnitId } });
      }
    } else if (plan.intent === "MEDIA_REQUEST") {
      contextKind = "MEDIA_REQUEST";
      const media = projectId ? await this.search.getProjectMedia(projectId) : [];
      verifiedFacts = this.serialize(media);
      trace.searchOperation = "GET_PROJECT_MEDIA"; trace.databaseResultCount = media.length;
      payload.uiActions.push({ type: "PROJECT_PHOTOS", payload: { projectId: projectId ?? null, media: this.serialize(media) } });
    } else if (plan.intent === "BROCHURE_REQUEST" || plan.executeBrochure) {
      contextKind = "BROCHURE_REQUEST";
      const documents = projectId ? await this.search.getProjectDocuments(projectId, DocumentType.BROCHURE) : [];
      verifiedFacts = this.serialize(documents);
      trace.searchOperation = "GET_PROJECT_BROCHURE"; trace.databaseResultCount = documents.length;
      if (plan.executeBrochure) payload.uiActions.push({ type: "PROJECT_BROCHURE", payload: { projectId: projectId ?? null, documents: this.serialize(documents) } });
      else state.presentation = nextPresentation(priorPresentation, { lastOfferedAction: "PROJECT_BROCHURE", awaitingConfirmation: Boolean(documents.length), selectedProjectId: projectId });
    } else if (plan.intent === "LOCATION_REQUEST") {
      contextKind = "PROJECT_DETAILS";
      const project = projectId ? await this.search.getProject(projectId) : null;
      const latitude = project?.latitude ?? project?.location?.latitude ?? null;
      const longitude = project?.longitude ?? project?.location?.longitude ?? null;
      const map = latitude != null && longitude != null ? { projectId, latitude, longitude, label: project?.name, url: `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}` } : null;
      verifiedFacts = map ? [this.serialize(map)] : [];
      trace.searchOperation = "GET_PROJECT_LOCATION"; trace.databaseResultCount = map ? 1 : 0;
      payload.uiActions.push({ type: "PROJECT_LOCATION", payload: { map } });
    } else if (plan.intent === "DISTANCE_REQUEST") {
      // The distance tool executes below after resolving contextual endpoints.
    } else if (state.preferredDevelopers?.length === 1 && /(?:المطور|سابقة|سلم|تاريخ|developer|track\s*record|portfolio)/iu.test(content)) {
      contextKind = "DEVELOPER_HISTORY";
      const developerName = state.preferredDevelopers[0];
      const developer = await this.prisma.developer.findFirst({ where: { OR: [{ name: { contains: developerName, mode: "insensitive" } }, { canonicalName: { contains: developerName, mode: "insensitive" } }, { nameAr: { contains: developerName, mode: "insensitive" } }, { nameEn: { contains: developerName, mode: "insensitive" } }] }, select: { id: true } });
      if (developer) verifiedFacts = [this.serialize(await this.search.getDeveloper(developer.id))];
      trace.searchOperation = "GET_DEVELOPER_STRUCTURED_FACTS";
      trace.databaseResultCount = developer ? 1 : 0;
    } else if (state.requestedProject && /(?:المشروع|project|تفاصيل|details|استثمار|investment|resale|rental|amenities|facilities)/iu.test(content)) {
      contextKind = /(?:إعادة\s*البيع|اعادة\s*البيع|resale)/iu.test(content) ? "RESALE" : /(?:إيجار|ايجار|rental|yield)/iu.test(content) ? "RENTAL" : /(?:استثمار|investment|عائد)/iu.test(content) ? "INVESTMENT" : /(?:خدمات|مرافق|amenities|facilities)/iu.test(content) ? "AMENITIES" : "PROJECT_DETAILS";
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
      contextKind = "AGGREGATION";
      const aggregate = await this.search.aggregateInventory(state);
      verifiedFacts = [this.serialize(aggregate)];
      trace.searchOperation = `AGGREGATE_${state.aggregationDimension}`;
      trace.databaseResultCount = aggregate.count;
      trace.aggregateQuery = { dimension: state.aggregationDimension };
    } else {
      const searchState = plan.widenSearch ? { ...state, requestedProject: undefined, preferredProjects: undefined } : state;
      properties = await this.search.searchProperties(searchState);
      verifiedFacts = this.serialize(properties);
      const originIds = await this.search.resolveLocations(state.locations);
      if (originIds.length) {
        const distances = await this.search.findNearbyLocations(
          originIds,
          state.maxTravelMinutes,
        );
        verifiedFacts = [...verifiedFacts, ...this.serialize(distances)];
      }
      const candidateIds = properties.map((property) => property.id);
      state.presentation = nextPresentation(priorPresentation, { searchCandidateIds: candidateIds, selectedProjectId: projectId ?? properties[0]?.projectId, lastOfferedAction: properties.length && !plan.emitCards ? "PROPERTY_CARDS" : !properties.length ? "SEARCH_WIDEN" : priorPresentation.lastOfferedAction, awaitingConfirmation: Boolean((properties.length && !plan.emitCards) || !properties.length) });
      if (plan.emitCards) {
        const unseenIds = new Set(unpresentedUnitIds(properties.map((property) => property.id), priorPresentation.presentedUnitIds));
        const unseen = properties.filter((property) => unseenIds.has(property.id));
        const cards = unseen.slice(0, 5);
        if (cards.length) {
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: cards.map((item) => this.cardProperty(item)) } });
          state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), ...cards.map((item) => item.id)])], lastPresentedUnitIds: cards.map((item) => item.id), awaitingConfirmation: false });
        } else state.presentation = nextPresentation(state.presentation, { awaitingConfirmation: false });
      }
    }
    trace.normalizedSearchFilters = await this.search.normalizedSearchFilters(state);
    trace.searchOperation ??= "SEARCH_PROPERTIES";
    trace.databaseResultCount ??= properties.length;

    if (plan.intent === "DISTANCE_REQUEST" || (state.exactRouteRequested && state.routeOrigin && state.routeDestination)) {
      const selectedProject = projectId ? await this.search.getProject(projectId) : null;
      const originText = state.routeOrigin || selectedProject?.name || selectedProject?.location?.name;
      const destinationText = state.routeDestination || this.distanceDestination(content);
      const destinationTerms = /\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content) ? [destinationText!, "AUC", "الجامعة الأمريكية"] : destinationText ? [destinationText] : [];
      const [origins, destinations] = await Promise.all([
        selectedProject?.locationId ? Promise.resolve([selectedProject.locationId]) : this.search.resolveLocations(originText ? [originText] : []),
        this.search.resolveLocations(destinationTerms),
      ]);
      const stored =
        origins.length && destinations.length
          ? await this.prisma.locationDistance.findFirst({
              where: { OR: [
                { fromLocationId: { in: origins }, toLocationId: { in: destinations }, verifiedAt: { not: null } },
                { fromLocationId: { in: destinations }, toLocationId: { in: origins }, verifiedAt: { not: null } },
              ] },
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
        : process.env.GOOGLE_MAPS_SERVER_API_KEY && originText && destinationText
          ? {
              source: "GOOGLE_ROUTES",
              ...((await this.maps.route(
                selectedProject?.latitude != null && selectedProject?.longitude != null ? `${selectedProject.latitude},${selectedProject.longitude}` : originText,
                destinationText,
              )) as object),
            }
          : { source: "UNAVAILABLE" };
      contextKind = "DISTANCE";
      verifiedFacts = [this.serialize(route)];
      payload.uiActions.push({ type: "DISTANCE_RESULT", payload: { route: this.serialize(route), origin: originText ?? null, destination: destinationText ?? null } });
      trace.searchOperation = stored ? "GET_VERIFIED_DISTANCE" : "GOOGLE_ROUTES";
      trace.databaseResultCount = stored ? 1 : 0;
    }

    const unitIds = properties.map((p) => p.id);
    if ((state.purchaseIntent ?? 0) >= 80 && !state.contactPhone && ["VIEWING_REQUEST", "CONTACT_REQUEST"].includes(plan.intent)) {
      payload.type = "lead_prompt";
      payload.uiActions.push({ type: "CONTACT_REQUEST", payload: { reason: plan.intent } });
    }
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
          existingState?.summary,
          contextKind,
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
      payload = { type: "lead_created", leadId: lead.id, uiActions: [] };
    }

    const cacheAfter = this.cache.stats();
    trace.action = plan.intent;
    trace.requiresDatabase = plan.requiresDatabase;
    trace.requiresGroq = true;
    trace.uiActionTypes = payload.uiActions.map((action) => action.type);
    trace.cardsEmitted = payload.uiActions.filter((action) => action.type === "PROPERTY_CARDS").reduce((count, action) => count + ((action.payload.properties as unknown[] | undefined)?.length ?? 0), 0);
    trace.cacheHits = cacheAfter.hits - cacheHits;
    trace.cacheMisses = cacheAfter.misses - cacheMisses;

    return this.finishPreparation(
      conversationId,
      conversation.detectedLanguage,
      state,
      payload,
      messages,
      properties,
      verifiedFacts,
      approvedKnowledge,
      existingState?.summary,
      contextKind,
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
    conversationSummary: unknown,
    contextKind: AIContextKind,
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
    const answerInput = compactAnswerInput({
      messages,
      intent: state,
      verifiedFacts,
      approvedKnowledge,
      conversationSummary,
      contextKind,
      candidatesBeforeRanking: properties.length || verifiedFacts.length,
      requestId: String(trace.requestId ?? "unknown"),
      conversationId,
    });
    const contextMetrics = answerContextMetrics(answerInput);
    const directAnswer = this.directToolAnswer(state, payload, verifiedFacts);
    trace.requiresGroq = !directAnswer;
    this.logger.log(`AIContextTrace ${JSON.stringify({requestId:answerInput.requestId,conversationId,intent:contextKind,candidatesBeforeRanking:properties.length||verifiedFacts.length,candidatesSent:contextMetrics.resultCount,historyMessagesSent:contextMetrics.recentHistoryCount,contextBytes:contextMetrics.contextBytes,estimatedTokens:contextMetrics.estimatedInputTokens})}`);
    return {
      conversationId,
      answerInput,
      state,
      payload,
      userMessages: messages,
      unitIds,
      trace: { ...trace, latencyMs: Date.now() - startedAt },
      directAnswer,
    };
  }

  async send(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    const answer = prepared.directAnswer ?? await this.ai.composeAnswer(prepared.answerInput);
    const message = await this.persistAssistant(prepared, answer);
    this.logTrace(prepared, { finalResponseProvider: "HYBRID", completed: true });
    return { message, state: prepared.state, ...prepared.payload };
  }

  async *stream(conversationId: string, rawToken: string, content: string, requestId = "unknown") {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId);
    let answer = "";
    try {
      if (prepared.directAnswer) { answer = prepared.directAnswer; yield { event: "token", data: { text: answer } }; }
      else for await (const chunk of this.ai.streamAnswer(prepared.answerInput)) { answer += chunk; yield { event: "token", data: { text: chunk } }; }
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
