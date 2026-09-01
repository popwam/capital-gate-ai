import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma, UnitStatus, ApprovalStatus, DocumentType } from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { StructuredIntent } from "./providers/ai-provider";
import { ApplicationCache } from "./cache/application-cache";
import { closestGate, spatialScore } from "./spatial-ranking";
import { chooseBestPaymentPlan, quotePaymentPlan } from "./payment-calculator";
import { resolveSearchableTotalPrice } from "./search/canonical-search-price";
import { validatePropertyAgainstActiveRequirement } from "./search/property-match-validator";

export type PropertySearchResult = {
  totalExactMatches: number;
  returnedCount: number;
  hasMore: boolean;
  properties: any[];
};

function effectiveObjective(intent: StructuredIntent): NonNullable<StructuredIntent["queryObjective"]> {
  const hardBudget = intent.budgetStrictness !== "APPROXIMATE" && (intent.priceMax ?? intent.budgetMax) != null;
  if (intent.queryObjective === "MOST_EXPENSIVE" && hardBudget) return "HIGHEST_WITHIN_BUDGET";
  return intent.queryObjective ?? (hardBudget ? "HIGHEST_WITHIN_BUDGET" : "BEST_MATCH");
}

function stableId(unit: { id?: unknown }) { return String(unit.id ?? ""); }
function finiteOr(value: unknown, fallback: number) {
  const number = value == null || value === "" ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function lowestPlanValue(unit: any, field: "downPaymentAmount" | "monthlyEquivalent") {
  return Math.min(...(Array.isArray(unit.paymentPlans) ? unit.paymentPlans : []).map((plan: any) => finiteOr(plan[field], Number.POSITIVE_INFINITY)));
}

const projectPublicInclude = {
  developer: {
    include: {
      portfolioProjects: {
        where: { verifiedAt: { not: null } },
        include: { location: true },
      },
    },
  },
  location: { include: { parent: true } },
  phases: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      marketProfiles: true,
      paymentPlans: { where: { isActive: true } },
    },
  },
  gates: {
    where: { isActive: true },
    include: { phase: true },
    orderBy: [{ isMain: "desc" }, { gateNumber: "asc" }],
  },
  zones: { include: { phase: true, buildings: { include: { phase: true } } } },
  amenities: { where: { verified: true }, include: { amenity: true } },
  investmentProfile: { where: { verifiedAt: { not: null } } },
  marketProfiles: true,
  landmarks: {
    where: { verifiedAt: { not: null } },
    include: { location: true },
  },
  competitorsFrom: {
    where: { verified: true },
    include: { competitorProject: { include: { developer: true, location: true } } },
  },
  knowledgeItems: { where: { approvalStatus: ApprovalStatus.APPROVED } },
} satisfies Prisma.ProjectInclude;

type PublicProject = Prisma.ProjectGetPayload<{ include: typeof projectPublicInclude }>;

@Injectable()
export class PropertySearchService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly cache?: ApplicationCache) { }
  private normalize(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
  private normalizeUnitCode(value: string) {
    return value
      .normalize("NFKC")
      .replace(/[‐‑‒–—−]/g, "-")
      .replace(/[／⁄]/g, "/")
      .replace(/\s*([\-_/])\s*/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  async resolveLocations(terms: string[] = []) {
    if (!terms.length) return [];
    const normalized = terms.map(x => this.normalize(x));
    const locationKey = JSON.stringify([...normalized].sort());
    const where: Prisma.LocationWhereInput = { OR: [
      { name: { in: terms, mode: "insensitive" } },
      { nameAr: { in: terms, mode: "insensitive" } },
      { nameEn: { in: terms, mode: "insensitive" } },
      { canonicalName: { in: terms, mode: "insensitive" } },
      { slug: { in: normalized.map(x => x.replace(/ /g, "-")) } },
      { aliases: { some: { normalizedValue: { in: normalized }, approvalStatus: ApprovalStatus.APPROVED } } },
    ] };
    const load = () => this.prisma.location.findMany({ where, select: { id: true } });
    const locations = await (this.cache?.getOrLoad("location-aliases", locationKey, 45 * 60_000, load) ?? load());
    const ids = new Set(locations.map(x => x.id));
    let frontier = [...ids];
    while (frontier.length) {
      const children = await this.prisma.location.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
      frontier = children.map(x => x.id).filter(id => !ids.has(id)); frontier.forEach(id => ids.add(id));
    }
    return [...ids];
  }

  private async attachEffectivePaymentPlans<T extends { id: string; projectId: string; phaseId?: string | null; price?: unknown; currency?: string | null; paymentPlans?: any[] }>(units: T[], intent?: StructuredIntent): Promise<Array<T & { paymentPlans: any[]; bestPaymentPlan: any | null }>> {
    if (!units.length) return [];
    const projectIds = [...new Set(units.map(unit => unit.projectId))];
    const phaseIds = [...new Set(units.map(unit => unit.phaseId).filter((id): id is string => Boolean(id)))];
    const validity = { OR: [{ validFrom: null }, { validFrom: { lte: new Date() } }], AND: [{ OR: [{ validTo: null }, { validTo: { gte: new Date() } }] }] };
    const [projectPlans, phasePlans] = await Promise.all([
      this.prisma.paymentPlan.findMany({
        where: { projectId: { in: projectIds }, phaseId: null, unitId: null, isActive: true, ...validity },
        orderBy: [{ durationMonths: "desc" }, { id: "asc" }],
      }),
      phaseIds.length ? this.prisma.paymentPlan.findMany({
        where: { phaseId: { in: phaseIds }, unitId: null, isActive: true, ...validity },
        orderBy: [{ durationMonths: "desc" }, { id: "asc" }],
      }) : Promise.resolve([]),
    ]);
    return units.map(unit => {
      const direct = Array.isArray(unit.paymentPlans) ? unit.paymentPlans : [];
      const inheritedProject = projectPlans.filter(plan => plan.projectId === unit.projectId);
      const inheritedPhase = unit.phaseId ? phasePlans.filter(plan => plan.phaseId === unit.phaseId) : [];
      const keyed = new Map<string, any>();
      for (const plan of [...inheritedProject, ...inheritedPhase, ...direct]) {
        const key = `${plan.durationMonths ?? "x"}:${plan.name ?? ""}:${plan.installmentFrequency ?? ""}`;
        keyed.set(key, plan); // unit-level plan is later and overrides equivalent project plan
      }
      const paymentPlans = [...keyed.values()].map(plan => {
        const quote = quotePaymentPlan(plan, unit.price, unit.currency);
        return { ...plan, ...quote, effectiveTotalPrice: quote.totalPrice };
      });
      const bestPaymentPlan = chooseBestPaymentPlan(paymentPlans, unit.price, unit.currency, {
        preferredPaymentDurationMonths: intent?.preferredPaymentDurationMonths,
        maxDownPayment: intent?.maxDownPayment,
        maxMonthlyInstallment: intent?.maxMonthlyInstallment,
        preferredDownPaymentPercent: intent?.preferredDownPaymentPercent,
      });
      return { ...unit, paymentPlans, bestPaymentPlan };
    });
  }

  private async attachEffectiveMedia<T extends {
    id: string; projectId: string; phaseId?: string | null; unitType?: string | null; unitSubType?: string | null;
    bedrooms?: number | null; bathrooms?: number | null; builtUpArea?: unknown; media?: any[];
  }>(units: T[]): Promise<Array<T & { media: any[] }>> {
    if (!units.length) return [];
    const projectIds = [...new Set(units.map((unit) => unit.projectId))];
    const rules = await this.prisma.unitMediaRule.findMany({
      where: { projectId: { in: projectIds }, isActive: true, media: { purpose: "UNIT_MATCH" } },
      include: { media: true },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
    const sameText = (a?: string | null, b?: string | null) => !a || (b != null && this.normalize(a) === this.normalize(b));
    return units.map((unit) => {
      const area = unit.builtUpArea == null ? null : Number(unit.builtUpArea);
      const matched = rules
        .filter((rule) => {
          if (rule.projectId !== unit.projectId) return false;
          if (rule.phaseId && rule.phaseId !== unit.phaseId) return false;
          if (!sameText(rule.unitType, unit.unitType)) return false;
          if (!sameText(rule.unitSubType, unit.unitSubType)) return false;
          if (rule.bedrooms != null && rule.bedrooms !== unit.bedrooms) return false;
          if (rule.bathrooms != null && rule.bathrooms !== unit.bathrooms) return false;
          if (rule.minBuiltUpArea != null && (area == null || area < Number(rule.minBuiltUpArea))) return false;
          if (rule.maxBuiltUpArea != null && (area == null || area > Number(rule.maxBuiltUpArea))) return false;
          return true;
        })
        .map((rule) => ({
          rule,
          specificity: [rule.phaseId, rule.unitType, rule.unitSubType, rule.bedrooms, rule.bathrooms, rule.minBuiltUpArea, rule.maxBuiltUpArea].filter((value) => value != null && value !== "").length,
        }))
        .sort((a, b) => b.rule.priority - a.rule.priority || b.specificity - a.specificity || a.rule.createdAt.getTime() - b.rule.createdAt.getTime());
      const directMedia = Array.isArray(unit.media) ? unit.media : [];
      const directTypes = new Set(directMedia.map((item: any) => item?.type).filter(Boolean));
      const media = new Map<string, any>();
      for (const item of directMedia) media.set(item.id, item);
      // A unit-specific asset overrides inherited rule assets of the same media type.
      // Example: a unique FLOOR_PLAN for one unit suppresses the phase/area FLOOR_PLAN,
      // while generic unit photos can still be inherited if the unit has no direct IMAGE.
      for (const match of matched) {
        if (directTypes.has(match.rule.media.type)) continue;
        if (!media.has(match.rule.media.id)) media.set(match.rule.media.id, { ...match.rule.media, matchedByRuleId: match.rule.id });
      }
      return { ...unit, media: [...media.values()] };
    });
  }

  private async normalizedWhere(intent: StructuredIntent): Promise<Prisma.UnitWhereInput | null> {
    if (intent.extractionDegraded && !intent.searchRelaxationAuthorized && !intent.locations?.length && intent.budgetMin == null && intent.budgetMax == null && intent.bedrooms == null && !intent.propertyTypes?.length && intent.builtUpAreaMin == null && intent.minimumArea == null && !intent.aggregationDimension && !intent.inventoryMarket && !intent.purpose) return null;
    const locationIds = await this.resolveLocations(intent.locations);
    if (intent.locations?.length && !locationIds.length) return null;
    const rejectedLocationIds = await this.resolveLocations(intent.rejectedLocations);
    if (locationIds.length && intent.maxTravelMinutes) {
      const nearby = await this.prisma.locationDistance.findMany({ where: { fromLocationId: { in: locationIds }, estimatedMinutes: { lte: intent.maxTravelMinutes } }, select: { toLocationId: true } });
      for (const item of nearby) if (!locationIds.includes(item.toLocationId)) locationIds.push(item.toLocationId);
    }
    const where: Prisma.UnitWhereInput = { status: UnitStatus.AVAILABLE, archivedAt: null };
    if (intent.bedrooms != null) where.bedrooms = intent.bedrooms;
    if (intent.inventoryMarket) where.isResale = intent.inventoryMarket === "RESALE";
    if (intent.bathrooms != null) where.bathrooms = { gte: intent.bathrooms };
    const priceMin = intent.priceMin ?? intent.budgetMin;
    const priceMax = intent.budgetStrictness === "APPROXIMATE" ? undefined : intent.priceMax ?? intent.budgetMax;
    if (priceMin != null || priceMax != null) where.price = { ...(priceMin != null ? { gte: priceMin } : {}), ...(priceMax != null ? { lte: priceMax } : {}) };
    if (intent.explicitRejectedPriceMin != null || intent.explicitRejectedPriceMax != null)
      where.NOT = { ...(where.NOT as object || {}), price: { gte: intent.explicitRejectedPriceMin, lte: intent.explicitRejectedPriceMax } };
    // Payment affordability is validated against inherited, phase, project,
    // and unit-level plans after those plans are resolved.
    const areaMin = intent.builtUpAreaMin ?? intent.minimumArea;
    const areaMax = intent.builtUpAreaMax ?? intent.maximumArea;
    if (areaMin != null || areaMax != null) where.builtUpArea = { gte: areaMin, lte: areaMax };
    if (intent.currency) where.currency = { equals: intent.currency, mode: "insensitive" };
    if (intent.deliveryMaxYears != null) { const latest = new Date(); latest.setFullYear(latest.getFullYear() + Math.ceil(intent.deliveryMaxYears)); where.deliveryDate = { lte: latest }; }
    if (intent.propertyTypes?.length) where.unitType = { in: intent.propertyTypes, mode: "insensitive" };
    if (intent.preferredFloor != null) where.floor = { equals: String(intent.preferredFloor), mode: "insensitive" };
    if (intent.preferredPhase) where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { OR: [
      { phase: { contains: intent.preferredPhase, mode: "insensitive" } },
      { phaseRef: { name: { contains: intent.preferredPhase, mode: "insensitive" } } },
      { phaseRef: { nameAr: { contains: intent.preferredPhase, mode: "insensitive" } } },
      { phaseRef: { nameEn: { contains: intent.preferredPhase, mode: "insensitive" } } },
    ] }];
    if (intent.preferredProjectZone) where.OR = [
      { cluster: { contains: intent.preferredProjectZone, mode: "insensitive" } },
      { projectZone: { name: { contains: intent.preferredProjectZone, mode: "insensitive" } } },
      { projectZone: { nameAr: { contains: intent.preferredProjectZone, mode: "insensitive" } } },
      { projectZone: { nameEn: { contains: intent.preferredProjectZone, mode: "insensitive" } } },
    ];
    if (intent.preferredBuilding) {
      const buildingFilter: Prisma.UnitWhereInput = {
        OR: [
          { building: { contains: intent.preferredBuilding, mode: "insensitive" } },
          { projectBuilding: { name: { contains: intent.preferredBuilding, mode: "insensitive" } } },
          { projectBuilding: { nameAr: { contains: intent.preferredBuilding, mode: "insensitive" } } },
          { projectBuilding: { nameEn: { contains: intent.preferredBuilding, mode: "insensitive" } } },
        ]
      };
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), buildingFilter];
    }
    const boundedProximity = intent.proximityPreferences?.filter(p => p.preference === "NEAR" && p.maxDistanceMeters != null) ?? [];
    for (const pref of boundedProximity) {
      const target = pref.targetName;
      const relation: Prisma.UnitProximityWhereInput = {
        targetType: pref.targetType,
        distanceMeters: { lte: pref.maxDistanceMeters },
        ...(pref.targetType === "GATE" && target ? { gate: { OR: [{ name: { contains: target, mode: "insensitive" } }, { nameAr: { contains: target, mode: "insensitive" } }, { nameEn: { contains: target, mode: "insensitive" } }, ...(target === "MAIN_GATE" ? [{ isMain: true }] : [])] } } : {}),
      };
      where.AND = [...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []), { proximities: { some: relation } }];
    }
    const projectWhere: Prisma.ProjectWhereInput = {};
    if (locationIds.length) projectWhere.locationId = { in: locationIds };
    if (rejectedLocationIds.length) projectWhere.NOT = { locationId: { in: rejectedLocationIds } };
    if (intent.rejectedProjects?.length) projectWhere.name = { notIn: intent.rejectedProjects, mode: "insensitive" };
    if (intent.preferredProjects?.length) projectWhere.OR = intent.preferredProjects.map(name => ({ name: { contains: name, mode: "insensitive" } }));
    if (intent.purpose) projectWhere.investmentProfile = {
      is: {
        verifiedAt: { not: null },
        ...(intent.purpose === "LIVING" ? { suitableForLiving: true } : { suitableForInvestment: true }),
      },
    };
    if (Object.keys(projectWhere).length) where.project = projectWhere;
    if (intent.preferredDevelopers?.length) where.developer = { OR: intent.preferredDevelopers.map(name => ({ name: { contains: name, mode: "insensitive" } })) };
    return where;
  }

  async normalizedSearchFilters(intent: StructuredIntent) {
    const locationIds = await this.resolveLocations(intent.locations);
    return {
      unitType: intent.propertyTypes ?? [],
      purpose: intent.purpose ?? null,
      inventoryMarket: intent.inventoryMarket ?? null,
      builtUpAreaMin: intent.builtUpAreaMin ?? intent.minimumArea ?? null,
      builtUpAreaMax: intent.builtUpAreaMax ?? intent.maximumArea ?? null,
      priceMin: intent.priceMin ?? intent.budgetMin ?? null,
      priceMax: intent.priceMax ?? intent.budgetMax ?? null,
      budgetStrictness: intent.budgetStrictness ?? "HARD",
      bedrooms: intent.bedrooms ?? null,
      locationIds,
      availability: [UnitStatus.AVAILABLE],
      preferredFloor: intent.preferredFloor ?? null,
      preferredPhase: intent.preferredPhase ?? null,
      preferredProjectZone: intent.preferredProjectZone ?? null,
      preferredBuilding: intent.preferredBuilding ?? null,
      preferredGate: intent.preferredGate ?? null,
      maxGateDistanceMeters: intent.maxGateDistanceMeters ?? null,
      preferredPaymentDurationMonths: intent.preferredPaymentDurationMonths ?? null,
      maxDownPayment: intent.maxDownPayment ?? null,
      maxMonthlyInstallment: intent.maxMonthlyInstallment ?? null,
      queryObjective: effectiveObjective(intent),
      proximityPreferences: intent.proximityPreferences ?? [],
    };
  }

  async aggregateInventory(intent: StructuredIntent) {
    const where = await this.normalizedWhere(intent);
    if (!where) return { dimension: intent.aggregationDimension, count: 0, values: [] };
    const dimension = intent.aggregationDimension;
    const cacheKey = JSON.stringify({ dimension, filters: await this.normalizedSearchFilters(intent) });
    const cached = this.cache?.get<any>("aggregation", cacheKey);
    if (cached !== undefined) return cached;
    if (dimension === "COUNT") {
      const result = { dimension, count: await this.prisma.unit.count({ where }), values: [] };
      this.cache?.set("aggregation", cacheKey, result, 60_000);
      return result;
    }
    if (dimension === "BUILT_UP_AREA") {
      const rows = await this.prisma.unit.findMany({ where: { ...where, builtUpArea: { ...(where.builtUpArea as object || {}), not: null } }, distinct: ["builtUpArea"], select: { builtUpArea: true }, orderBy: { builtUpArea: "asc" } });
      const result = { dimension, count: rows.length, values: rows.map((row) => Number(row.builtUpArea)) };
      this.cache?.set("aggregation", cacheKey, result, 60_000); return result;
    }
    if (dimension === "PRICE") {
      const rows = await this.prisma.unit.findMany({ where: { ...where, price: { ...(where.price as object || {}), not: null } }, distinct: ["price"], select: { price: true, currency: true }, orderBy: { price: "asc" } });
      const result = { dimension, count: rows.length, values: rows.map((row) => ({ price: Number(row.price), currency: row.currency })) };
      this.cache?.set("aggregation", cacheKey, result, 60_000); return result;
    }
    if (dimension === "LOCATION") {
      const rows = await this.prisma.unit.findMany({ where, distinct: ["projectId"], select: { project: { select: { location: { select: { id: true, name: true } } } } } });
      const values = [...new Map(rows.flatMap((row) => row.project.location ? [[row.project.location.id, row.project.location]] as const : [])).values()];
      const result = { dimension, count: values.length, values }; this.cache?.set("aggregation", cacheKey, result, 60_000); return result;
    }
    const select = dimension === "PROJECT" ? { project: { select: { id: true, name: true } } } : dimension === "DEVELOPER" ? { developer: { select: { id: true, name: true } } } : dimension === "UNIT_TYPE" ? { unitType: true } : dimension === "DELIVERY_DATE" ? { deliveryDate: true } : dimension === "BEDROOM_COUNT" ? { bedrooms: true } : { paymentPlans: { where: { isActive: true, durationMonths: { not: null } }, select: { durationMonths: true } } };
    const rows = await this.prisma.unit.findMany({ where, select: select as any });
    const values = dimension === "PROJECT" ? rows.map((row: any) => row.project) : dimension === "DEVELOPER" ? rows.map((row: any) => row.developer) : dimension === "UNIT_TYPE" ? rows.map((row: any) => row.unitType).filter(Boolean) : dimension === "DELIVERY_DATE" ? rows.map((row: any) => row.deliveryDate).filter(Boolean) : dimension === "BEDROOM_COUNT" ? rows.map((row: any) => row.bedrooms).filter((value: any) => value != null) : rows.flatMap((row: any) => row.paymentPlans.map((plan: any) => plan.durationMonths));
    const unique = [...new Map(values.map((value: any) => [typeof value === "object" ? value.id ?? JSON.stringify(value) : String(value), value])).values()];
    const result = { dimension, count: unique.length, values: unique }; this.cache?.set("aggregation", cacheKey, result, 60_000); return result;
  }

  async searchPropertiesWithMetadata(intent: StructuredIntent, limit = 8): Promise<PropertySearchResult> {
    const where = await this.normalizedWhere(intent);
    if (!where) return { totalExactMatches: 0, returnedCount: 0, hasMore: false, properties: [] };
    const locationIds = await this.resolveLocations(intent.locations);
    const objective = effectiveObjective(intent);
    const needsResolvedPaymentPool = ["LOWEST_DOWN_PAYMENT", "LOWEST_INSTALLMENT"].includes(objective)
      || intent.maxDownPayment != null || intent.maxMonthlyInstallment != null || intent.preferredPaymentDurationMonths != null;
    const poolSize = objective === "BEST_MATCH" ? Math.max(limit * 4, 20) : limit;
    const cacheKey = JSON.stringify({ filters: await this.normalizedSearchFilters(intent), pool: needsResolvedPaymentPool ? "ALL" : poolSize });
    const include: Prisma.UnitInclude = {
      developer: {
        select: {
          id: true,
          name: true,
          nameAr: true,
          nameEn: true,
          brandName: true,
        },
      },
      project: {
        include: {
          location: true,
          developer: true,
          gates: {
            where: { isActive: true },
            orderBy: [
              { isMain: "desc" },
              { gateNumber: "asc" },
            ],
          },
          amenities: {
            where: { verified: true },
            include: { amenity: true },
          },
          investmentProfile: true,
        },
      },
      phaseRef: true,
      projectZone: true,
      projectBuilding: true,
      proximities: {
        include: {
          gate: true,
          amenity: true,
          landmark: true,
        },
      },
      paymentPlans: {
        where: { isActive: true },
      },
      offers: {
        where: { isActive: true },
      },
      media: {
        take: 1,
        orderBy: { sortOrder: "asc" },
      },
    }; 
    const orderBy: Prisma.UnitOrderByWithRelationInput[] = objective === "CHEAPEST"
      ? [{ price: { sort: "asc", nulls: "last" } }, { id: "asc" }]
      : ["HIGHEST_WITHIN_BUDGET", "MOST_EXPENSIVE"].includes(objective)
        ? [{ price: { sort: "desc", nulls: "last" } }, { id: "asc" }]
        : objective === "EARLIEST_DELIVERY"
          ? [{ deliveryDate: { sort: "asc", nulls: "last" } }, { id: "asc" }]
          : objective === "LARGEST_AREA"
            ? [{ builtUpArea: { sort: "desc", nulls: "last" } }, { id: "asc" }]
            : [{ availabilityUpdatedAt: "desc" }, { price: { sort: "asc", nulls: "last" } }, { id: "asc" }];
    const loader = () => this.prisma.unit.findMany({
      where,
      ...(needsResolvedPaymentPool ? {} : { take: poolSize }),
      orderBy,
      include,
    });
    const raw = await (this.cache?.getOrLoad("property-search-v3", cacheKey, 20_000, loader) ?? loader());
    const withPlans = await this.attachEffectivePaymentPlans(raw as any[], intent);
    const units = await this.attachEffectiveMedia(withPlans);
    const validated = units.filter((unit) => validatePropertyAgainstActiveRequirement(unit as any, intent, { locationIds }).valid);
    const ranked = validated.map(unit => {
      const canonicalPrice = resolveSearchableTotalPrice(unit);
      let score = 40;
      const reasons: string[] = ["currently available"];
      if (intent.bedrooms != null && unit.bedrooms === intent.bedrooms) { score += 14; reasons.push("bedroom match"); }
      if (intent.bathrooms != null && unit.bathrooms != null && unit.bathrooms >= intent.bathrooms) { score += 5; reasons.push("bathroom match"); }
      const budgetReference = intent.priceMax ?? intent.budgetMax ?? intent.priceTarget;
      if (budgetReference != null && canonicalPrice && canonicalPrice.amount <= budgetReference) { score += 14; reasons.push("within budget"); }
      if (locationIds.length && unit.project.locationId && locationIds.includes(unit.project.locationId)) { score += 9; reasons.push("location match"); }
      if (intent.propertyTypes?.length && unit.unitType && intent.propertyTypes.some(x => this.normalize(x) === this.normalize(unit.unitType!))) { score += 9; reasons.push("property type match"); }
      if (intent.builtUpAreaMin != null && unit.builtUpArea && Number(unit.builtUpArea) >= intent.builtUpAreaMin) { score += 5; reasons.push("area match"); }
      const spatial = spatialScore(unit as any, intent); score += spatial.score; reasons.push(...spatial.reasons);
      if (unit.bestPaymentPlan) {
        if (intent.preferredPaymentDurationMonths && unit.bestPaymentPlan.durationMonths === intent.preferredPaymentDurationMonths) { score += 7; reasons.push("payment duration match"); }
        if (intent.maxDownPayment != null && unit.bestPaymentPlan.downPaymentAmount != null && unit.bestPaymentPlan.downPaymentAmount <= intent.maxDownPayment) { score += 7; reasons.push("down payment match"); }
        if (intent.maxMonthlyInstallment != null && unit.bestPaymentPlan.monthlyEquivalent != null && unit.bestPaymentPlan.monthlyEquivalent <= intent.maxMonthlyInstallment) { score += 7; reasons.push("monthly installment match"); }
      }
      return {
        ...unit,
        price: canonicalPrice?.amount ?? null,
        currency: canonicalPrice?.currency ?? unit.currency,
        canonicalPrice,
        closestGate: closestGate(unit as any),
        matchScore: Math.max(0, Math.min(100, score)),
        matchReasons: [...new Set(reasons)],
      };
    });
    ranked.sort((a, b) => {
      if (objective === "CHEAPEST") return finiteOr(a.price, Number.POSITIVE_INFINITY) - finiteOr(b.price, Number.POSITIVE_INFINITY) || b.matchScore - a.matchScore || stableId(a).localeCompare(stableId(b));
      if (["HIGHEST_WITHIN_BUDGET", "MOST_EXPENSIVE"].includes(objective)) return finiteOr(b.price, Number.NEGATIVE_INFINITY) - finiteOr(a.price, Number.NEGATIVE_INFINITY) || b.matchScore - a.matchScore || stableId(a).localeCompare(stableId(b));
      if (objective === "LOWEST_DOWN_PAYMENT") return lowestPlanValue(a, "downPaymentAmount") - lowestPlanValue(b, "downPaymentAmount") || b.matchScore - a.matchScore || stableId(a).localeCompare(stableId(b));
      if (objective === "LOWEST_INSTALLMENT") return lowestPlanValue(a, "monthlyEquivalent") - lowestPlanValue(b, "monthlyEquivalent") || b.matchScore - a.matchScore || stableId(a).localeCompare(stableId(b));
      if (objective === "EARLIEST_DELIVERY") return finiteOr(a.deliveryDate == null ? null : new Date(a.deliveryDate).getTime(), Number.POSITIVE_INFINITY) - finiteOr(b.deliveryDate == null ? null : new Date(b.deliveryDate).getTime(), Number.POSITIVE_INFINITY) || stableId(a).localeCompare(stableId(b));
      if (objective === "LARGEST_AREA") return finiteOr(b.builtUpArea, Number.NEGATIVE_INFINITY) - finiteOr(a.builtUpArea, Number.NEGATIVE_INFINITY) || stableId(a).localeCompare(stableId(b));
      return b.matchScore - a.matchScore || stableId(a).localeCompare(stableId(b));
    });
    const properties = ranked.slice(0, limit);
    const count = needsResolvedPaymentPool
      ? ranked.length
      : typeof (this.prisma.unit as any).count === "function"
        ? await (this.prisma.unit as any).count({ where })
        : validated.length;
    return { totalExactMatches: count, returnedCount: properties.length, hasMore: count > properties.length, properties };
  }

  async searchProperties(intent: StructuredIntent, limit = 8) {
    return (await this.searchPropertiesWithMetadata(intent, limit)).properties;
  }

  async getProperty(id: string) { const unit = await this.prisma.unit.findFirst({ where: { id, status: UnitStatus.AVAILABLE, archivedAt: null }, include: { developer: true, project: { include: { location: true, developer: true, gates: { where: { isActive: true } } } }, phaseRef: true, projectZone: true, projectBuilding: true, proximities: { include: { gate: true, amenity: true, landmark: true } }, paymentPlans: { where: { isActive: true } }, offers: true, media: true, priceHistory: { orderBy: { effectiveAt: "desc" } } } }); if (!unit) throw new NotFoundException("Property not found"); const withPlans = await this.attachEffectivePaymentPlans([unit]); return (await this.attachEffectiveMedia(withPlans))[0]; }
  async findUnitByExternalId(externalUnitId: string) {
    const normalized = this.normalizeUnitCode(externalUnitId);
    const variants = [...new Set([
      externalUnitId.trim(),
      normalized,
      normalized.replace(/_/g, "-"),
      normalized.replace(/-/g, "_"),
    ].filter(Boolean))];
    const matches = await this.prisma.unit.findMany({
      where: {
        OR: variants.map((value) => ({ externalUnitId: { equals: value, mode: "insensitive" as const } })),
        status: UnitStatus.AVAILABLE,
        archivedAt: null,
      },
      take: 2,
      orderBy: [{ externalUnitId: "asc" }, { id: "asc" }],
      include: {
        developer: { select: { id: true, name: true, nameAr: true, nameEn: true, brandName: true } },
        project: { include: { location: true, developer: true, gates: { where: { isActive: true } } } },
        phaseRef: true, projectZone: true, projectBuilding: true,
        proximities: { include: { gate: true, amenity: true, landmark: true } },
        paymentPlans: { where: { isActive: true } },
        offers: { where: { isActive: true } },
        media: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (matches.length > 1) throw new ConflictException("Unit code matches more than one available unit");
    const unit = matches[0];
    if (!unit) return null;
    const withPlans = await this.attachEffectivePaymentPlans([unit]);
    return (await this.attachEffectiveMedia(withPlans))[0];
  }
  async findUnitsByExternalPrefix(reference: string, limit = 5) {
    const normalized = this.normalizeUnitCode(reference);
    if (normalized.length < 3) return [];
    const variants = [...new Set([
      normalized,
      normalized.replace(/_/g, "-"),
      normalized.replace(/-/g, "_"),
    ].filter(Boolean))];
    const units = await this.prisma.unit.findMany({
      where: { OR: variants.map((value) => ({ externalUnitId: { contains: value, mode: "insensitive" as const } })), status: UnitStatus.AVAILABLE, archivedAt: null },
      take: limit,
      orderBy: [{ externalUnitId: "asc" }],
      include: {
        developer: { select: { id: true, name: true, nameAr: true, nameEn: true, brandName: true } },
        project: { include: { location: true, developer: true, gates: { where: { isActive: true } } } },
        phaseRef: true, projectZone: true, projectBuilding: true,
        proximities: { include: { gate: true, amenity: true, landmark: true } },
        paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } }, media: { orderBy: { sortOrder: "asc" } },
      },
    });
    const withPlans = await this.attachEffectivePaymentPlans(units as any[]);
    return this.attachEffectiveMedia(withPlans);
  }

  async findProjectByName(name: string) { return this.prisma.project.findFirst({ where: { OR: [{ name: { contains: name, mode: "insensitive" } }, { canonicalName: { contains: name, mode: "insensitive" } }, { nameAr: { contains: name, mode: "insensitive" } }, { nameEn: { contains: name, mode: "insensitive" } }] }, select: { id: true } }); }
  async getProject(id: string): Promise<PublicProject> {
    const loader = async (): Promise<PublicProject> => {
      const project = await this.prisma.project.findUnique({
        where: { id },
        include: projectPublicInclude,
      });
      if (!project) throw new NotFoundException("Project not found");
      return project;
    };
    if (this.cache) return this.cache.getOrLoad<PublicProject>("project-public", id, 30_000, loader);
    return loader();
  }
  async getDeveloper(id: string) { const loader = async () => { const developer = await this.prisma.developer.findUnique({ where: { id }, include: { portfolioProjects: { where: { verifiedAt: { not: null } }, include: { location: true } }, projects: { where: { adminStatus: "READY_FOR_CUSTOMER" }, select: { id: true, name: true, nameAr: true, nameEn: true, projectStatus: true, deliveryStatus: true } } } }); if (!developer) throw new NotFoundException("Developer not found"); return developer; }; return this.cache?.getOrLoad("developer-public", id, 60_000, loader) ?? loader(); }

  async getUnitsByIds(ids: string[]) {
    if (!ids.length) return [];
    const units = await this.prisma.unit.findMany({
      where: { id: { in: ids }, status: UnitStatus.AVAILABLE, archivedAt: null },
      include: {
        developer: { select: { id: true, name: true, nameAr: true, nameEn: true, brandName: true } },
        project: { include: { location: true, developer: true, gates: { where: { isActive: true } } } },
        phaseRef: true, projectZone: true, projectBuilding: true, proximities: { include: { gate: true, amenity: true, landmark: true } },
        paymentPlans: { where: { isActive: true } },
        offers: { where: { isActive: true } },
        media: { take: 1, orderBy: { sortOrder: "asc" } },
      },
    });
    const withPlans = await this.attachEffectivePaymentPlans(units as any[]);
    return this.attachEffectiveMedia(withPlans);
  }

  async getPaymentPlanResult(unitId: string) {
    const unit = await this.prisma.unit.findFirst({
      where: { id: unitId, status: UnitStatus.AVAILABLE, archivedAt: null },
      select: {
        id: true, externalUnitId: true, projectId: true, phaseId: true, price: true, currency: true,
        project: { select: { name: true, nameAr: true, nameEn: true } },
        paymentPlans: { where: { isActive: true } },
      },
    });
    if (!unit) throw new NotFoundException("Property not found");
    const effective = (await this.attachEffectivePaymentPlans([unit]))[0];
    const plans = effective.paymentPlans.filter((plan) => {
      if (plan.unitId != null) return plan.unitId === unit.id;
      if (plan.phaseId != null) return plan.phaseId === unit.phaseId && plan.projectId === unit.projectId;
      return plan.projectId === unit.projectId;
    });
    return {
      unit: {
        id: unit.id,
        externalUnitId: unit.externalUnitId,
        projectId: unit.projectId,
        projectName: unit.project.nameAr ?? unit.project.nameEn ?? unit.project.name,
      },
      plans,
    };
  }
  async compareProperties(ids: string[]) { return this.prisma.unit.findMany({ where: { id: { in: ids }, status: UnitStatus.AVAILABLE }, include: { project: true, paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } } } }); }
  async getProjectMedia(projectId: string) { return this.cache?.getOrLoad("project-media", projectId, 15 * 60_000, () => this.prisma.media.findMany({ where: { projectId, phaseId: null, type: "IMAGE", purpose: "GALLERY" }, orderBy: { sortOrder: "asc" } })) ?? this.prisma.media.findMany({ where: { projectId, phaseId: null, type: "IMAGE", purpose: "GALLERY" }, orderBy: { sortOrder: "asc" } }); }
  async getProjectDocuments(projectId: string, type?: DocumentType) { const key = `${projectId}:${type ?? "ALL"}`; return this.cache?.getOrLoad("project-documents", key, 15 * 60_000, () => this.prisma.document.findMany({ where: { projectId, phaseId: null, ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" } })) ?? this.prisma.document.findMany({ where: { projectId, phaseId: null, ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" } }); }
  async findNearbyLocations(locationIds: string[], maxMinutes?: number) { return this.prisma.locationDistance.findMany({ where: { fromLocationId: { in: locationIds }, ...(maxMinutes ? { estimatedMinutes: { lte: maxMinutes } } : {}) }, include: { from: true, to: true }, orderBy: { estimatedMinutes: "asc" } }); }
}
