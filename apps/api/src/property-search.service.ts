import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, UnitStatus, ApprovalStatus, DocumentType } from "@prisma/client";
import { PrismaService } from "./database/prisma.service";
import { StructuredIntent } from "./providers/ai-provider";

@Injectable()
export class PropertySearchService {
  constructor(private readonly prisma: PrismaService) {}
  private normalize(value: string) { return value.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }

  async resolveLocations(terms: string[] = []) {
    if (!terms.length) return [];
    const normalized = terms.map(x => this.normalize(x));
    const locations = await this.prisma.location.findMany({ where: { OR: [{ name: { in: terms, mode: "insensitive" } }, { slug: { in: normalized.map(x => x.replace(/ /g, "-")) } }, { aliases: { some: { normalizedValue: { in: normalized }, approvalStatus: ApprovalStatus.APPROVED } } }] }, select: { id: true } });
    const ids = new Set(locations.map(x => x.id));
    let frontier = [...ids];
    while (frontier.length) {
      const children = await this.prisma.location.findMany({ where: { parentId: { in: frontier } }, select: { id: true } });
      frontier = children.map(x => x.id).filter(id => !ids.has(id)); frontier.forEach(id => ids.add(id));
    }
    return [...ids];
  }

  private async normalizedWhere(intent: StructuredIntent): Promise<Prisma.UnitWhereInput | null> {
    if (intent.extractionDegraded && !intent.locations?.length && intent.budgetMin == null && intent.budgetMax == null && intent.bedrooms == null && !intent.propertyTypes?.length && intent.builtUpAreaMin == null && intent.minimumArea == null && !intent.aggregationDimension) return null;
    const locationIds = await this.resolveLocations(intent.locations);
    if (intent.locations?.length && !locationIds.length) return null;
    const rejectedLocationIds = await this.resolveLocations(intent.rejectedLocations);
    if (locationIds.length && intent.maxTravelMinutes) {
      const nearby = await this.prisma.locationDistance.findMany({ where: { fromLocationId: { in: locationIds }, estimatedMinutes: { lte: intent.maxTravelMinutes } }, select: { toLocationId: true } });
      for (const item of nearby) if (!locationIds.includes(item.toLocationId)) locationIds.push(item.toLocationId);
    }
    const where: Prisma.UnitWhereInput = { status: UnitStatus.AVAILABLE, archivedAt: null };
    if (intent.bedrooms != null) where.bedrooms = intent.bedrooms;
    if (intent.bathrooms != null) where.bathrooms = { gte: intent.bathrooms };
    if (intent.budgetMin != null || intent.budgetMax != null) where.price = { gte: intent.budgetMin, lte: intent.budgetMax };
    if (intent.maxDownPayment != null) where.downPayment = { lte: intent.maxDownPayment };
    const areaMin = intent.builtUpAreaMin ?? intent.minimumArea;
    const areaMax = intent.builtUpAreaMax ?? intent.maximumArea;
    if (areaMin != null || areaMax != null) where.builtUpArea = { gte: areaMin, lte: areaMax };
    if (intent.currency) where.currency = { equals: intent.currency, mode: "insensitive" };
    if (intent.deliveryMaxYears != null) { const latest = new Date(); latest.setFullYear(latest.getFullYear() + Math.ceil(intent.deliveryMaxYears)); where.deliveryDate = { lte: latest }; }
    if (intent.propertyTypes?.length) where.unitType = { in: intent.propertyTypes, mode: "insensitive" };
    const projectWhere: Prisma.ProjectWhereInput = {};
    if (locationIds.length) projectWhere.locationId = { in: locationIds };
    if (rejectedLocationIds.length) projectWhere.NOT = { locationId: { in: rejectedLocationIds } };
    if (intent.rejectedProjects?.length) projectWhere.name = { notIn: intent.rejectedProjects, mode: "insensitive" };
    if (intent.preferredProjects?.length) projectWhere.OR = intent.preferredProjects.map(name => ({ name: { contains: name, mode: "insensitive" } }));
    if (Object.keys(projectWhere).length) where.project = projectWhere;
    if (intent.preferredDevelopers?.length) where.developer = { OR: intent.preferredDevelopers.map(name => ({ name: { contains: name, mode: "insensitive" } })) };
    return where;
  }

  async normalizedSearchFilters(intent: StructuredIntent) {
    const locationIds = await this.resolveLocations(intent.locations);
    return {
      unitType: intent.propertyTypes ?? [],
      builtUpAreaMin: intent.builtUpAreaMin ?? intent.minimumArea ?? null,
      builtUpAreaMax: intent.builtUpAreaMax ?? intent.maximumArea ?? null,
      priceMin: intent.budgetMin ?? null,
      priceMax: intent.budgetMax ?? null,
      bedrooms: intent.bedrooms ?? null,
      locationIds,
      availability: [UnitStatus.AVAILABLE],
    };
  }

  async aggregateInventory(intent: StructuredIntent) {
    const where = await this.normalizedWhere(intent);
    if (!where) return { dimension: intent.aggregationDimension, count: 0, values: [] };
    const dimension = intent.aggregationDimension;
    if (dimension === "BUILT_UP_AREA") {
      const rows = await this.prisma.unit.findMany({ where: { ...where, builtUpArea: { ...(where.builtUpArea as object || {}), not: null } }, distinct: ["builtUpArea"], select: { builtUpArea: true }, orderBy: { builtUpArea: "asc" } });
      return { dimension, count: rows.length, values: rows.map((row) => Number(row.builtUpArea)) };
    }
    if (dimension === "PRICE") {
      const rows = await this.prisma.unit.findMany({ where: { ...where, price: { ...(where.price as object || {}), not: null } }, distinct: ["price"], select: { price: true, currency: true }, orderBy: { price: "asc" } });
      return { dimension, count: rows.length, values: rows.map((row) => ({ price: Number(row.price), currency: row.currency })) };
    }
    if (dimension === "LOCATION") {
      const rows = await this.prisma.unit.findMany({ where, distinct: ["projectId"], select: { project: { select: { location: { select: { id: true, name: true } } } } } });
      const values = [...new Map(rows.flatMap((row) => row.project.location ? [[row.project.location.id, row.project.location]] as const : [])).values()];
      return { dimension, count: values.length, values };
    }
    const select = dimension === "PROJECT" ? { project: { select: { id: true, name: true } } } : dimension === "DEVELOPER" ? { developer: { select: { id: true, name: true } } } : dimension === "UNIT_TYPE" ? { unitType: true } : dimension === "DELIVERY_DATE" ? { deliveryDate: true } : dimension === "BEDROOM_COUNT" ? { bedrooms: true } : { paymentPlans: { where: { isActive: true, durationMonths: { not: null } }, select: { durationMonths: true } } };
    const rows = await this.prisma.unit.findMany({ where, select: select as any });
    const values = dimension === "PROJECT" ? rows.map((row: any) => row.project) : dimension === "DEVELOPER" ? rows.map((row: any) => row.developer) : dimension === "UNIT_TYPE" ? rows.map((row: any) => row.unitType).filter(Boolean) : dimension === "DELIVERY_DATE" ? rows.map((row: any) => row.deliveryDate).filter(Boolean) : dimension === "BEDROOM_COUNT" ? rows.map((row: any) => row.bedrooms).filter((value: any) => value != null) : rows.flatMap((row: any) => row.paymentPlans.map((plan: any) => plan.durationMonths));
    const unique = [...new Map(values.map((value: any) => [typeof value === "object" ? value.id ?? JSON.stringify(value) : String(value), value])).values()];
    return { dimension, count: unique.length, values: unique };
  }

  async searchProperties(intent: StructuredIntent, limit = 8) {
    const where = await this.normalizedWhere(intent);
    if (!where) return [];
    const locationIds = await this.resolveLocations(intent.locations);
    const units = await this.prisma.unit.findMany({ where, take: limit, orderBy: [{ availabilityUpdatedAt: "desc" }, { price: "asc" }], include: { developer: { select: { id: true, name: true, nameAr: true, nameEn: true, brandName: true } }, project: { include: { location: true, amenities: { where: { verified: true }, include: { amenity: true } }, investmentProfile: true } }, paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } } } });
    return units.map(unit => { let score = 50; const reasons: string[] = ["currently available"];
      if (intent.bedrooms != null && unit.bedrooms === intent.bedrooms) { score += 15; reasons.push("bedroom match"); }
      if (intent.budgetMax != null && unit.price && Number(unit.price) <= intent.budgetMax) { score += 15; reasons.push("within budget"); }
      if (locationIds.length && unit.project.locationId && locationIds.includes(unit.project.locationId)) { score += 10; reasons.push("location match"); }
      if (intent.propertyTypes?.length && unit.unitType && intent.propertyTypes.some(x => x.toLowerCase() === unit.unitType!.toLowerCase())) { score += 10; reasons.push("property type match"); }
      return { ...unit, matchScore: Math.min(100, score), matchReasons: reasons }; });
  }

  async getProperty(id: string) { const unit = await this.prisma.unit.findUnique({ where: { id }, include: { developer: true, project: { include: { location: true } }, paymentPlans: true, offers: true, media: true, priceHistory: { orderBy: { effectiveAt: "desc" } } } }); if (!unit) throw new NotFoundException("Property not found"); return unit; }
  async findProjectByName(name: string) { return this.prisma.project.findFirst({ where: { OR: [{ name: { contains: name, mode: "insensitive" } }, { canonicalName: { contains: name, mode: "insensitive" } }, { nameAr: { contains: name, mode: "insensitive" } }, { nameEn: { contains: name, mode: "insensitive" } }] }, select: { id: true } }); }
  async getProject(id: string) { const project = await this.prisma.project.findUnique({ where: { id }, include: { developer: { include: { portfolioProjects: { where: { verifiedAt: { not: null } }, include: { location: true } } } }, location: { include: { parent: true } }, amenities: { where: { verified: true }, include: { amenity: true } }, investmentProfile: true, landmarks: { where: { verifiedAt: { not: null } }, include: { location: true } }, competitorsFrom: { where: { verified: true }, include: { competitorProject: { include: { developer: true, location: true } } } }, knowledgeItems: { where: { approvalStatus: ApprovalStatus.APPROVED } } } }); if (!project) throw new NotFoundException("Project not found"); return project; }
  async getDeveloper(id: string) { const developer = await this.prisma.developer.findUnique({ where: { id }, include: { portfolioProjects: { where: { verifiedAt: { not: null } }, include: { location: true } }, projects: { where: { adminStatus: "READY_FOR_CUSTOMER" }, select: { id: true, name: true, nameAr: true, nameEn: true, projectStatus: true, deliveryStatus: true } } } }); if (!developer) throw new NotFoundException("Developer not found"); return developer; }
  async getPaymentPlans(unitId: string) { return this.prisma.paymentPlan.findMany({ where: { unitId, isActive: true } }); }
  async compareProperties(ids: string[]) { return this.prisma.unit.findMany({ where: { id: { in: ids }, status: UnitStatus.AVAILABLE }, include: { project: true, paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } } } }); }
  async getProjectMedia(projectId: string) { return this.prisma.media.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }); }
  async getProjectDocuments(projectId: string, type?: DocumentType) { return this.prisma.document.findMany({ where: { projectId, ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" } }); }
  async findNearbyLocations(locationIds: string[], maxMinutes?: number) { return this.prisma.locationDistance.findMany({ where: { fromLocationId: { in: locationIds }, ...(maxMinutes ? { estimatedMinutes: { lte: maxMinutes } } : {}) }, include: { from: true, to: true }, orderBy: { estimatedMinutes: "asc" } }); }
}
