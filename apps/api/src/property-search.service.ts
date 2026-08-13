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

  async searchProperties(intent: StructuredIntent, limit = 8) {
    if (intent.extractionDegraded && !intent.locations?.length && intent.budgetMin == null && intent.budgetMax == null && intent.bedrooms == null && !intent.propertyTypes?.length) return [];
    const locationIds = await this.resolveLocations(intent.locations);
    if (intent.locations?.length && !locationIds.length) return [];
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
    if (intent.minimumArea != null || intent.maximumArea != null) where.builtUpArea = { gte: intent.minimumArea, lte: intent.maximumArea };
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
    const units = await this.prisma.unit.findMany({ where, take: limit, orderBy: [{ availabilityUpdatedAt: "desc" }, { price: "asc" }], include: { developer: { select: { id: true, name: true } }, project: { include: { location: true } }, paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } } } });
    return units.map(unit => { let score = 50; const reasons: string[] = ["currently available"];
      if (intent.bedrooms != null && unit.bedrooms === intent.bedrooms) { score += 15; reasons.push("bedroom match"); }
      if (intent.budgetMax != null && unit.price && Number(unit.price) <= intent.budgetMax) { score += 15; reasons.push("within budget"); }
      if (locationIds.length && unit.project.locationId && locationIds.includes(unit.project.locationId)) { score += 10; reasons.push("location match"); }
      if (intent.propertyTypes?.length && unit.unitType && intent.propertyTypes.some(x => x.toLowerCase() === unit.unitType!.toLowerCase())) { score += 10; reasons.push("property type match"); }
      return { ...unit, matchScore: Math.min(100, score), matchReasons: reasons }; });
  }

  async getProperty(id: string) { const unit = await this.prisma.unit.findUnique({ where: { id }, include: { developer: true, project: { include: { location: true } }, paymentPlans: true, offers: true, media: true, priceHistory: { orderBy: { effectiveAt: "desc" } } } }); if (!unit) throw new NotFoundException("Property not found"); return unit; }
  async getProject(id: string) { const project = await this.prisma.project.findUnique({ where: { id }, include: { developer: true, location: true, knowledgeItems: { where: { approvalStatus: ApprovalStatus.APPROVED } } } }); if (!project) throw new NotFoundException("Project not found"); return project; }
  async getPaymentPlans(unitId: string) { return this.prisma.paymentPlan.findMany({ where: { unitId, isActive: true } }); }
  async compareProperties(ids: string[]) { return this.prisma.unit.findMany({ where: { id: { in: ids }, status: UnitStatus.AVAILABLE }, include: { project: true, paymentPlans: { where: { isActive: true } }, offers: { where: { isActive: true } } } }); }
  async getProjectMedia(projectId: string) { return this.prisma.media.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }); }
  async getProjectDocuments(projectId: string, type?: DocumentType) { return this.prisma.document.findMany({ where: { projectId, ...(type ? { type } : {}) }, orderBy: { createdAt: "desc" } }); }
  async findNearbyLocations(locationIds: string[], maxMinutes?: number) { return this.prisma.locationDistance.findMany({ where: { fromLocationId: { in: locationIds }, ...(maxMinutes ? { estimatedMinutes: { lte: maxMinutes } } : {}) }, include: { from: true, to: true }, orderBy: { estimatedMinutes: "asc" } }); }
}
