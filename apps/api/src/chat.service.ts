import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";
import {
  DocumentType,
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
import { applyDeterministicTurnSemantics, nextPresentation, planCustomerTurn, presentationAfterPropertySearch, suggestedUnitIdsAfterTurn, UIAction, unpresentedUnitIds } from "./customer-turn-planner";
import { ApplicationCache } from "./cache/application-cache";
import { CustomerTrustService } from "./customer-trust.service";
import {
  ConversationFormatterService,
  DeterministicAnswerService,
  LeadHandoffService,
  PaymentPresenterService,
  PropertyPresenterService,
} from "./conversation";

type MessagePayload = {
  type:
    | "text"
    | "properties"
    | "media"
    | "documents"
    | "map"
    | "lead_prompt"
    | "lead_created"
    | "conversation_closed";
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
  isFirstTurn: boolean;
};
export { leadPersistenceAction } from "./conversation";

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
    private readonly trust: CustomerTrustService,
    private readonly formatter: ConversationFormatterService,
    private readonly deterministicAnswers: DeterministicAnswerService,
    private readonly paymentPresenter: PaymentPresenterService,
    private readonly propertyPresenter: PropertyPresenterService,
    private readonly leadHandoff: LeadHandoffService,
  ) {}

  private serialize(value: unknown) {
    return JSON.parse(JSON.stringify(value));
  }

  async prepare(
    conversationId: string,
    rawToken: string,
    content: string,
    requestId = "unknown",
    displayContent?: string,
  ): Promise<Prepared> {
    const startedAt = Date.now();
    const { conversation } = await this.conversations.assertOwned(
      conversationId,
      rawToken,
    );
    const existingState = await this.prisma.conversationState.findUnique({ where: { conversationId } });
    const existingSearchContext = existingState?.searchContext as StructuredIntent | null;
    if (existingSearchContext?.presentation?.conversationClosed) {
      throw new ConflictException({ code: "CONVERSATION_CLOSED", message: "This conversation is closed. Start a new conversation to continue." });
    }
    await this.prisma.message.create({
      data: { conversationId, role: MessageRole.USER, content: displayContent?.trim() || content },
    });
    const history = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    const messages: AIMessage[] = history.reverse().map((m) => ({
      role: m.role === MessageRole.USER ? "user" : "assistant",
      content: m.content,
    }));
    const isFirstTurn = history.filter((message) => message.role === MessageRole.USER).length === 1;
    const previous =
      (existingState?.searchContext as StructuredIntent | null) ?? {
        language: conversation.detectedLanguage ?? "ar-EG",
      };
    const plan = planCustomerTurn(content, previous);
    const extracted = plan.requiresExtraction
      ? await this.ai.extractIntent(messages, previous, { requestId, conversationId })
      : normalizeRealEstateSemantics(content, deterministicIntent(messages, previous), previous);
    const state = applyDeterministicTurnSemantics(content, extracted, previous, plan);
    this.trust.applyConversationPreferences(state, content);
    const trace: Record<string, unknown> = {
      requestId,
      conversationId,
      inputLanguage: state.language,
      extractedIntent: plan.intent,
      aggregationDimension: state.aggregationDimension ?? null,
      previousConversationState: this.safeTraceState(previous),
      newConversationState: this.safeTraceState(state),
      extractionDegraded: Boolean(state.extractionDegraded),
      isFirstTurn,
    };
    let properties: any[] = [];
    let payload: MessagePayload = { type: "text", uiActions: [] };
    let verifiedFacts: unknown[] = [];
    let approvedKnowledge: unknown[] = [];
    let contextKind: AIContextKind = "PROPERTY_SEARCH";
    let trustDirectAnswer: string | undefined;
    const priorUnitIds = existingState?.suggestedUnitIds ?? [];
    const priorPresentation = previous.presentation ?? {};

    // Passive trust signals are deliberately conservative. One unclear message is
    // never labelled fake. We only surface a review alert for an invalid phone,
    // an explicit placeholder identity, or repeated nonsense, and the admin makes
    // the final fraud/fake decision.
    const activeHandoff = ["PAYMENT", "IDENTITY", "CONFIRMATION", "CONTACT_PREFERENCES"].includes(String(priorPresentation.leadHandoffStage ?? ""));
    const identityClaim = /(?:^|\s)(?:اسمي|انا\s+اسمي|أنا\s+اسمي|my\s+name\s+is|name\s+is)(?:\s|:|-)/iu.test(content);
    const phoneLike = /(?:\+?\d[\d\s().-]{3,}\d)/u.test(content);
    const explicitPhoneCue = /(?:رقمي|رقم\s*(?:الموبايل|التليفون|الهاتف)|موبايل|تليفون|هاتف|phone|mobile|whats?app|واتساب)/iu.test(content);
    const standaloneEgyptianPhone = /^\s*(?:\+?20|0020)?\s*01[0125](?:[\s().-]*\d){8}\s*$/u.test(content);
    const phoneClaim = phoneLike && (explicitPhoneCue || standaloneEgyptianPhone);
    const passiveTrustTrigger = !activeHandoff && !["VIEWING_REQUEST", "CONTACT_REQUEST"].includes(plan.intent) && (plan.intent === "UNKNOWN" || identityClaim || phoneClaim);
    if (passiveTrustTrigger) {
      const passiveAssessment = await this.trust.assessContact({
        conversationId,
        content,
        state,
        contactExpected: identityClaim,
        allowImplicitPhone: identityClaim || phoneClaim,
      });
      if (passiveAssessment.level !== "CONTACT_VALID") {
        await this.trust.recordAlert({ conversationId, assessment: passiveAssessment, content });
        trace.customerTrust = {
          level: passiveAssessment.level,
          score: passiveAssessment.score,
          reasons: passiveAssessment.reasons,
          passive: true,
          learnedFromFeedback: passiveAssessment.learnedFromFeedback,
        };
        if (plan.intent === "UNKNOWN" && passiveAssessment.reasons.some((reason) => ["unclear_input", "repeated_nonsense_input"].includes(reason))) {
          trustDirectAnswer = this.trust.unclearMessage(state.language?.startsWith("ar"));
        }
      }
    }
    const contextualUnitIds = this.deterministicAnswers.contextualUnitIds(previous, priorUnitIds);
    let cacheHits = this.cache.stats().hits;
    let cacheMisses = this.cache.stats().misses;

    let projectId = priorPresentation.selectedProjectId;
    const rawReferencedProject = state.requestedProject ?? this.deterministicAnswers.projectReference(content, plan.intent);
    const referencedProject = rawReferencedProject
      ?.replace(/^(?:المشروع|مشروع|project)\s+/iu, "")
      .replace(/[؟?]+$/u, "")
      .trim();
    if (referencedProject) {
      const matchedProject = await this.search.findProjectByName(referencedProject);
      if (matchedProject?.id) {
        projectId = matchedProject.id;
        state.requestedProject = referencedProject;
        state.presentation = nextPresentation(state.presentation ?? priorPresentation, {
          selectedProjectId: matchedProject.id,
          lastReferencedEntity: { type: "PROJECT", id: matchedProject.id },
        });
      }
    }
    if (!projectId && priorPresentation.selectedUnitId)
      projectId = (await this.prisma.unit.findUnique({ where: { id: priorPresentation.selectedUnitId }, select: { projectId: true } }))?.projectId;
    if (!projectId && priorUnitIds.length) {
      const projectRefs = await this.prisma.unit.findMany({ where: { id: { in: priorUnitIds } }, select: { projectId: true } });
      const uniqueProjectIds = [...new Set(projectRefs.map((item) => item.projectId).filter(Boolean))];
      if (uniqueProjectIds.length === 1) projectId = uniqueProjectIds[0];
    }

    if (plan.intent === "OUT_OF_DOMAIN") {
      trace.searchOperation = "NONE";
      trace.databaseResultCount = 0;
      payload = { type: "conversation_closed", uiActions: [{ type: "CONVERSATION_CLOSED", payload: { reason: "OUT_OF_DOMAIN" } }] };
    } else if (plan.intent === "SMALL_TALK") {
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
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: unit.id, selectedProjectId: unit.projectId, lastReferencedEntity: { type: "UNIT", id: unit.id }, awaitingConfirmation: false });
        if (plan.emitCards) {
          const alreadyShown = (priorPresentation.presentedUnitIds ?? []).includes(unit.id);
          if (!alreadyShown || plan.intent === "VIEWING_REQUEST") {
            payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: [this.propertyPresenter.cardProperty(unit)] } });
            state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), unit.id])], lastPresentedUnitIds: [unit.id] });
          }
        }
        if (plan.intent === "VIEWING_REQUEST") payload.uiActions.push({ type: "VIEWING_REQUEST", payload: { unitId: unit.id, externalUnitId: unit.externalUnitId } });
      } else {
        const candidates = await this.search.findUnitsByExternalPrefix(plan.exactUnitId, 6);
        if (candidates.length) {
          properties = candidates;
          verifiedFacts = this.serialize(candidates);
          const candidateProjectIds = [...new Set(candidates.map((item: any) => item.projectId).filter(Boolean))];
          if (candidateProjectIds.length === 1) projectId = candidateProjectIds[0];
          state.presentation = nextPresentation(priorPresentation, {
            selectedUnitId: undefined,
            selectedProjectId: projectId,
            searchCandidateIds: candidates.map((item: any) => item.id),
            lastPresentedUnitIds: candidates.map((item: any) => item.id),
            awaitingConfirmation: false,
          });
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: candidates.map((item: any) => this.propertyPresenter.cardProperty(item)) } });
          trace.searchOperation = "UNIT_PREFIX_LOOKUP";
          trace.databaseResultCount = candidates.length;
        }
      }
    } else if (plan.intent === "PROPERTY_DETAILS" && !plan.exactUnitId) {
      const selectedId = priorPresentation.selectedUnitId ?? priorPresentation.lastPresentedUnitIds?.[0] ?? contextualUnitIds[0];
      const unit = selectedId ? await this.search.getProperty(selectedId).catch(() => null) : null;
      trace.searchOperation = "CONTEXT_UNIT_LOOKUP";
      trace.databaseResultCount = unit ? 1 : 0;
      if (unit) {
        properties = [unit]; verifiedFacts = this.serialize(properties); projectId = unit.projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: unit.id, selectedProjectId: unit.projectId, lastReferencedEntity: { type: "UNIT", id: unit.id }, awaitingConfirmation: false });
        if (plan.emitCards && !(priorPresentation.presentedUnitIds ?? []).includes(unit.id)) {
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: [this.propertyPresenter.cardProperty(unit)] } });
          state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), unit.id])], lastPresentedUnitIds: [unit.id] });
        }
      }
    } else if (plan.intent === "MEDIA_REQUEST") {
      contextKind = "MEDIA_REQUEST";
      let media: any[] = [];
      let mediaUnitId: string | null = null;
      if (plan.exactUnitId) {
        const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
        if (unit) { media = unit.media ?? []; mediaUnitId = unit.id; projectId = unit.projectId; }
      } else if (this.deterministicAnswers.asksUnitMedia(content)) {
        const selectedId = priorPresentation.selectedUnitId ?? priorPresentation.lastPresentedUnitIds?.[0] ?? contextualUnitIds[0];
        if (selectedId) {
          const unit = await this.search.getProperty(selectedId).catch(() => null);
          if (unit) { media = unit.media ?? []; mediaUnitId = unit.id; projectId = unit.projectId; }
        }
      }
      if (!mediaUnitId) media = projectId ? await this.search.getProjectMedia(projectId) : [];
      verifiedFacts = this.serialize(media);
      trace.searchOperation = mediaUnitId ? "GET_UNIT_MEDIA" : "GET_PROJECT_MEDIA"; trace.databaseResultCount = media.length;
      payload.uiActions.push({ type: "PROJECT_PHOTOS", payload: { projectId: projectId ?? null, unitId: mediaUnitId, media: this.serialize(media), scope: mediaUnitId ? "UNIT" : "PROJECT" } });
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
    } else if (plan.intent === "PROJECT_DETAILS") {
      if (projectId) {
        contextKind = "PROJECT_DETAILS";
        const project = await this.search.getProject(projectId).catch(() => null);
        verifiedFacts = project ? [this.serialize(project)] : [];
        approvedKnowledge = project?.knowledgeItems ?? [];
        trace.searchOperation = "GET_CONTEXT_PROJECT";
        trace.databaseResultCount = project ? 1 : 0;
      } else {
        contextKind = "PROPERTY_SEARCH";
        const units = await this.search.getUnitsByIds(contextualUnitIds.slice(0, 5));
        verifiedFacts = this.serialize(units);
        trace.searchOperation = "GET_CONTEXT_PROJECTS_FROM_UNITS";
        trace.databaseResultCount = units.length;
      }
    } else if (["INVESTMENT", "RESALE", "RENTAL"].includes(plan.intent) && projectId) {
      contextKind = plan.intent as AIContextKind;
      const project = await this.search.getProject(projectId).catch(() => null);
      verifiedFacts = project ? [this.serialize(project)] : [];
      approvedKnowledge = project?.knowledgeItems ?? [];
      if (project) state.presentation = nextPresentation(priorPresentation, { selectedProjectId: project.id, lastReferencedEntity: { type: "PROJECT", id: project.id } });
      trace.searchOperation = `GET_CONTEXT_PROJECT_${plan.intent}`;
      trace.databaseResultCount = project ? 1 : 0;
    } else if (plan.intent === "COMPARISON" && projectId) {
      contextKind = "PROJECT_DETAILS";
      const project = await this.search.getProject(projectId).catch(() => null);
      if (project) {
        const competitorIds = (project.competitorsFrom ?? []).map((row: any) => row.competitorProject?.id).filter(Boolean).slice(0, 6);
        const competitors = (await Promise.all(competitorIds.map((id: string) => this.search.getProject(id).catch(() => null)))).filter(Boolean);
        verifiedFacts = this.serialize([project, ...competitors]);
        approvedKnowledge = project.knowledgeItems ?? [];
        state.presentation = nextPresentation(priorPresentation, { selectedProjectId: project.id, lastReferencedEntity: { type: "PROJECT", id: project.id } });
        trace.searchOperation = "GET_PROJECT_AND_REGISTERED_COMPETITORS";
        trace.databaseResultCount = 1 + competitors.length;
      } else {
        trace.searchOperation = "GET_PROJECT_AND_REGISTERED_COMPETITORS";
        trace.databaseResultCount = 0;
      }
    } else if (plan.intent === "DEVELOPER_DETAILS") {
      const asksDeveloperList = /(?:مطورين|المطورين|developers?)/iu.test(content) && /(?:تعرف|عندك|ايه|اي|what|available|موجود|متاح)/iu.test(content);
      if (asksDeveloperList) {
        contextKind = "AGGREGATION";
        const aggregateState: StructuredIntent = { ...state, temporaryIntent: "INVENTORY_AGGREGATION", aggregationDimension: "DEVELOPER" };
        const aggregate = await this.search.aggregateInventory(aggregateState);
        verifiedFacts = [this.serialize(aggregate)];
        trace.searchOperation = "AGGREGATE_DEVELOPER";
        trace.databaseResultCount = aggregate.count;
      } else if (contextualUnitIds.length) {
        contextKind = "PROPERTY_SEARCH";
        const units = await this.search.getUnitsByIds(contextualUnitIds.slice(0, 5));
        verifiedFacts = this.serialize(units);
        trace.searchOperation = "GET_CONTEXT_DEVELOPERS_FROM_UNITS";
        trace.databaseResultCount = units.length;
      } else if (projectId) {
        contextKind = "PROJECT_DETAILS";
        const project = await this.search.getProject(projectId).catch(() => null);
        verifiedFacts = project ? [this.serialize(project)] : [];
        trace.searchOperation = "GET_CONTEXT_PROJECT_DEVELOPER";
        trace.databaseResultCount = project ? 1 : 0;
      } else if (state.preferredDevelopers?.length === 1) {
        contextKind = "DEVELOPER_HISTORY";
        const developerName = state.preferredDevelopers[0];
        const developer = await this.prisma.developer.findFirst({ where: { OR: [{ name: { contains: developerName, mode: "insensitive" } }, { canonicalName: { contains: developerName, mode: "insensitive" } }, { nameAr: { contains: developerName, mode: "insensitive" } }, { nameEn: { contains: developerName, mode: "insensitive" } }] }, select: { id: true } });
        if (developer) verifiedFacts = [this.serialize(await this.search.getDeveloper(developer.id))];
        trace.searchOperation = "GET_DEVELOPER_STRUCTURED_FACTS";
        trace.databaseResultCount = developer ? 1 : 0;
      } else {
        trace.searchOperation = "GET_CONTEXT_DEVELOPER";
        trace.databaseResultCount = 0;
      }
    } else if (plan.intent === "PAYMENT_PLAN") {
      contextKind = "PROPERTY_SEARCH";
      let units: any[] = [];
      if (plan.exactUnitId) {
        const unit = await this.search.findUnitByExternalId(plan.exactUnitId);
        if (unit) units = [unit];
      } else {
        const ids = (priorPresentation.selectedUnitId
          ? [priorPresentation.selectedUnitId]
          : priorPresentation.lastPresentedUnitIds?.length
            ? priorPresentation.lastPresentedUnitIds
            : contextualUnitIds).slice(0, 8);
        units = await this.search.getUnitsByIds(ids);
        // When the customer says something like "الشقة 155 لو كاش", keep the
        // conversational candidates but resolve the concrete area before choosing
        // which unit's inherited payment plan to explain.
        const targetArea = state.targetBuiltUpArea ?? state.builtUpAreaMin ?? state.minimumArea;
        if (!priorPresentation.selectedUnitId && targetArea != null) {
          units = [...units].sort((a: any, b: any) => {
            const aArea = a?.builtUpArea == null ? Number.POSITIVE_INFINITY : Math.abs(Number(a.builtUpArea) - Number(targetArea));
            const bArea = b?.builtUpArea == null ? Number.POSITIVE_INFINITY : Math.abs(Number(b.builtUpArea) - Number(targetArea));
            return aArea - bArea;
          });
        }
      }
      properties = units;
      verifiedFacts = this.serialize(units);
      if (units.length === 1) {
        projectId = units[0].projectId;
        state.presentation = nextPresentation(priorPresentation, { selectedUnitId: units[0].id, selectedProjectId: units[0].projectId, lastReferencedEntity: { type: "UNIT", id: units[0].id } });
      }
      trace.searchOperation = "GET_PAYMENT_PLANS";
      trace.databaseResultCount = units.reduce((count, unit) => count + (unit.paymentPlans?.length ?? 0), 0);
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
      trace.propertySearchExecuted = true;
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
      const candidateProjectIds = [...new Set(properties.map((property) => property.projectId).filter(Boolean))];
      const contextualProjectId = projectId ?? (candidateProjectIds.length === 1 ? candidateProjectIds[0] : undefined);
      state.presentation = presentationAfterPropertySearch(priorPresentation, candidateIds, contextualProjectId, plan.emitCards);
      if (plan.emitCards) {
        const unseenIds = new Set(unpresentedUnitIds(properties.map((property) => property.id), priorPresentation.presentedUnitIds));
        const unseen = properties.filter((property) => unseenIds.has(property.id));
        const cards = unseen.slice(0, 5);
        if (cards.length) {
          payload.uiActions.push({ type: "PROPERTY_CARDS", payload: { properties: cards.map((item) => this.propertyPresenter.cardProperty(item)) } });
          state.presentation = nextPresentation(state.presentation, { presentedUnitIds: [...new Set([...(priorPresentation.presentedUnitIds ?? []), ...cards.map((item) => item.id)])], lastPresentedUnitIds: cards.map((item) => item.id), awaitingConfirmation: false });
        } else state.presentation = nextPresentation(state.presentation, { awaitingConfirmation: false });
      }
    }
    trace.normalizedSearchFilters = await this.search.normalizedSearchFilters(state);
    trace.searchOperation ??= "SEARCH_PROPERTIES";
    trace.databaseResultCount ??= properties.length;

    if (plan.intent === "DISTANCE_REQUEST" || (state.exactRouteRequested && state.routeOrigin && state.routeDestination)) {
      const selectedProject = projectId ? await this.search.getProject(projectId).catch(() => null) : null;
      const originText = state.routeOrigin || selectedProject?.nameAr || selectedProject?.nameEn || selectedProject?.name || selectedProject?.location?.name;
      const destinationText = state.routeDestination || this.deterministicAnswers.distanceDestination(content);
      const destinationTerms = /\bAUC\b|الجامعه\s+الامريكيه|الجامعة\s+الأمريكية/iu.test(content) ? [destinationText!, "AUC", "الجامعة الأمريكية"] : destinationText ? [destinationText] : [];
      const [origins, destinations] = await Promise.all([
        selectedProject?.locationId ? Promise.resolve([selectedProject.locationId]) : this.search.resolveLocations(originText ? [originText] : []),
        this.search.resolveLocations(destinationTerms),
      ]);
      const stored = origins.length && destinations.length
        ? await this.prisma.locationDistance.findFirst({
            where: { OR: [
              { fromLocationId: { in: origins }, toLocationId: { in: destinations }, verifiedAt: { not: null } },
              { fromLocationId: { in: destinations }, toLocationId: { in: origins }, verifiedAt: { not: null } },
            ] },
            include: { from: true, to: true },
          })
        : null;

      let originPoint: { latitude:number; longitude:number } | null = null;
      if (selectedProject) {
        const latitude = Number(selectedProject.latitude ?? selectedProject.location?.latitude);
        const longitude = Number(selectedProject.longitude ?? selectedProject.location?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) originPoint = { latitude, longitude };
      } else if (origins.length) {
        const location = await this.prisma.location.findFirst({ where: { id: { in: origins }, latitude: { not: null }, longitude: { not: null } }, select: { latitude: true, longitude: true } });
        const latitude = Number(location?.latitude), longitude = Number(location?.longitude);
        if (Number.isFinite(latitude) && Number.isFinite(longitude)) originPoint = { latitude, longitude };
      }

      let route: Record<string, unknown>;
      if (stored) {
        route = {
          source: stored.distanceType === "GOOGLE_ROUTES" ? "GOOGLE_ROUTES" : "ADMIN_VERIFIED",
          distanceKm: Number(stored.distanceKm),
          estimatedMinutes: stored.estimatedMinutes,
          from: stored.from.name,
          to: stored.to.name,
          notes: stored.notes,
        };
      } else if (originPoint && destinationText && process.env.GOOGLE_MAPS_SERVER_API_KEY) {
        const destinationPlace = await this.maps.firstPlace(destinationText).catch(() => null);
        const liveRoute = destinationPlace
          ? await this.maps.routePoints(originPoint, { latitude: destinationPlace.latitude, longitude: destinationPlace.longitude }).catch(() => null)
          : null;
        route = liveRoute && destinationPlace
          ? {
              source: "GOOGLE_ROUTES",
              ...liveRoute,
              from: originText ?? "المشروع",
              to: destinationPlace.name,
              destinationName: destinationPlace.name,
              destinationAddress: destinationPlace.formattedAddress,
            }
          : { source: "UNAVAILABLE", reason: "ROUTE_DATA_UNAVAILABLE" };
      } else {
        route = { source: "UNAVAILABLE", reason: originPoint ? "DESTINATION_UNRESOLVED" : "PROJECT_COORDINATES_MISSING" };
      }
      contextKind = "DISTANCE";
      verifiedFacts = [this.serialize(route)];
      payload.uiActions.push({ type: "DISTANCE_RESULT", payload: { route: this.serialize(route), origin: originText ?? null, destination: destinationText ?? null } });
      trace.searchOperation = stored ? "GET_VERIFIED_DISTANCE" : "GOOGLE_ROUTES";
      trace.databaseResultCount = stored ? 1 : 0;
    }

    const priorHandoffStage = priorPresentation.leadHandoffStage;
    const selectedUnitId = state.presentation?.selectedUnitId ?? priorPresentation.selectedUnitId;
    let handoffUnit = properties.find((item) => item.id === selectedUnitId) ?? null;
    if (!handoffUnit && selectedUnitId) handoffUnit = await this.search.getProperty(selectedUnitId).catch(() => null);
    const handoff = await this.leadHandoff.handleLeadCapture({
      conversationId,
      content,
      state,
      previous,
      plan: { intent: plan.intent, exactUnitId: plan.exactUnitId },
      handoffUnit,
      priorHandoffStage,
      priorPresentation,
      priorUnitIds,
    });
    if (handoff.payload) payload = handoff.payload;
    if (handoff.trustTrace) trace.customerTrust = handoff.trustTrace;
    if (handoff.directAnswer) trustDirectAnswer = handoff.directAnswer;
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
      conversation.promptVariant,
      trustDirectAnswer ?? plan.deterministicResponse,
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
    promptVariant: string,
    deterministicResponse: string | undefined,
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
          suggestedUnitIds: suggestedUnitIdsAfterTurn(unitIds, trace.propertySearchExecuted === true),
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
      promptVersion: "v1",
      promptVariant,
    });
    const contextMetrics = answerContextMetrics(answerInput);
    let directAnswer = deterministicResponse ?? (state.turnIntent === "SMALL_TALK" ? this.formatter.smallTalkAnswer(state) : this.deterministicAnswers.directToolAnswer(state, payload, verifiedFacts, undefined, contextKind, properties.length));
    if (!directAnswer && trace.requiresDatabase) {
      directAnswer = this.propertyPresenter.verifiedFactsAnswer(state, verifiedFacts, contextKind)
        ?? (state.language?.startsWith("ar") ? "المعلومة المطلوبة مش متاحة في البيانات الموثقة عندي حاليًا." : "The requested information is not available in the verified data right now.");
      trace.groundingMode = "DETERMINISTIC_VERIFIED_FACTS";
    }
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
      isFirstTurn: Boolean(trace.isFirstTurn),
    };
  }

  async send(conversationId: string, rawToken: string, content: string, requestId = "unknown", displayContent?: string) {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId, displayContent);
    const rawAnswer = prepared.directAnswer ?? await this.ai.composeAnswer(prepared.answerInput);
    let answer = this.formatter.sanitizeCustomerAnswer(rawAnswer, prepared.state.language);
    if (!prepared.directAnswer && this.propertyPresenter.hasGroundingContradiction(answer, prepared.answerInput.verifiedFacts)) {
      this.logger.warn(`AIGroundingContradiction ${JSON.stringify({ requestId, conversationId, intent: prepared.state.turnIntent })}`);
      answer = this.propertyPresenter.groundedFallback(prepared.state, prepared.answerInput.verifiedFacts);
    }
    answer = this.formatter.withFirstTurnIntro(answer, prepared.state, prepared.isFirstTurn);
    const message = await this.persistAssistant(prepared, answer);
    this.logTrace(prepared, { finalResponseProvider: "HYBRID", completed: true });
    return { message, state: prepared.state, ...prepared.payload };
  }

  async *stream(conversationId: string, rawToken: string, content: string, requestId = "unknown", displayContent?: string) {
    const prepared = await this.prepare(conversationId, rawToken, content, requestId, displayContent);
    let answer = "";
    try {
      if (prepared.directAnswer) answer = prepared.directAnswer;
      else for await (const chunk of this.ai.streamAnswer(prepared.answerInput)) answer += chunk;
      if (!answer.trim()) throw new Error("AI_EMPTY_CUSTOMER_RESPONSE");
      answer = this.formatter.sanitizeCustomerAnswer(answer, prepared.state.language);
      if (!prepared.directAnswer && this.propertyPresenter.hasGroundingContradiction(answer, prepared.answerInput.verifiedFacts)) {
        this.logger.warn(`AIGroundingContradiction ${JSON.stringify({ requestId, conversationId, intent: prepared.state.turnIntent })}`);
        answer = this.propertyPresenter.groundedFallback(prepared.state, prepared.answerInput.verifiedFacts);
      }
      answer = this.formatter.withFirstTurnIntro(answer, prepared.state, prepared.isFirstTurn);
      for (let offset = 0; offset < answer.length; offset += 180) yield { event: "token", data: { text: answer.slice(offset, offset + 180) } };
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
