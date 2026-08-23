import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from "class-validator";
import { AuditService } from "../audit.service";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { ApplicationCache } from "../cache/application-cache";
import { locateUnitOnMasterPlan } from "../providers/master-plan-vision";
import { calibrateMasterPlan } from "../master-plan-calibration";

class DeveloperDetailsDto {
  @IsOptional() @IsString() @MaxLength(160) canonicalName?: string;
  @IsOptional() @IsString() @MaxLength(160) nameAr?: string;
  @IsOptional() @IsString() @MaxLength(160) nameEn?: string;
  @IsOptional() @IsString() @MaxLength(80) shortName?: string;
  @IsOptional() @IsString() @MaxLength(160) brandName?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsString() coverImageUrl?: string;
  @IsOptional() @IsUrl({ require_tld: false }) website?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1800) foundedYear?: number;
  @IsOptional() @IsString() headquarters?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() developerType?: string;
  @IsOptional() @IsString() salesPhone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() socialLinks?: Prisma.InputJsonValue;
  @IsOptional() @IsString() shortDescriptionAr?: string;
  @IsOptional() @IsString() shortDescriptionEn?: string;
  @IsOptional() @IsString() fullDescriptionAr?: string;
  @IsOptional() @IsString() fullDescriptionEn?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) yearsInMarket?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) deliveredProjectsCount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) projectsUnderConstructionCount?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) geographicFocus?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) specialties?: string[];
}

class PortfolioDto {
  @IsString() projectName!: string;
  @IsOptional() @IsString() locationText?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() projectType?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) projectTypes?: string[];
  @IsIn(["DELIVERED", "UNDER_CONSTRUCTION", "UPCOMING", "HISTORICAL"]) status!: string;
  @IsOptional() @Type(() => Number) @IsInt() launchYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() deliveryYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) unitsCount?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() source?: string;
}

class ProjectDetailsDto {
  @IsOptional() @IsString() canonicalName?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() shortDescriptionAr?: string;
  @IsOptional() @IsString() shortDescriptionEn?: string;
  @IsOptional() @IsString() fullDescriptionAr?: string;
  @IsOptional() @IsString() fullDescriptionEn?: string;
  @IsOptional() @IsIn(["DRAFT", "READY_FOR_CUSTOMER", "ARCHIVED"]) adminStatus?: string;
  @IsOptional() @IsDateString() launchDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() launchYear?: number;
  @IsOptional() @IsUrl({ require_tld: false }) officialWebsite?: string;
  @IsOptional() @IsString() formattedAddress?: string;
  @IsOptional() @IsString() googlePlaceId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @IsString() projectStatus?: string;
  @IsOptional() @IsString() projectType?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) projectTypes?: string[];
  @IsOptional() @IsString() deliveryInformation?: string;
  @IsOptional() @IsString() deliveryStatus?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) deliveryStatuses?: string[];
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() deliveryYear?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) finishingOptions?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) totalLandArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) builtUpPercentage?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) numberOfPhases?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) totalUnits?: number;
  @IsOptional() @IsString() densityDescription?: string;
  @IsOptional() @IsBoolean() gatedCommunity?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) unitTypes?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxArea?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minBedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxBedrooms?: number;
  @IsOptional() @IsString() priceSummary?: string;
  @IsOptional() @IsString() paymentSummary?: string;
  @IsOptional() @IsString() maintenanceSummary?: string;
  @IsOptional() @IsString() clubFeesSummary?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) customerFit?: string[];
}

class InvestmentDto {
  @IsOptional() @IsBoolean() suitableForLiving?: boolean;
  @IsOptional() @IsBoolean() suitableForInvestment?: boolean;
  @IsOptional() @IsBoolean() suitableForRental?: boolean;
  @IsOptional() @IsIn(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]) resaleDemand?: string;
  @IsOptional() @IsIn(["UNKNOWN", "LOW", "MEDIUM", "HIGH"]) rentalDemand?: string;
  @IsOptional() @Type(() => Number) @IsNumber() expectedRentalYieldMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() expectedRentalYieldMax?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) strongestUnitTypes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) targetCustomers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) investmentAdvantages?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) investmentRisks?: string[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() source?: string;
}

class AmenityDto {
  @IsString() canonicalName!: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() description?: string;
}
class ProjectAmenityDto {
  @IsArray() @IsString({ each: true }) amenityIds!: string[];
}
class LandmarkDto {
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() distanceKm?: number;
  @IsOptional() @Type(() => Number) @IsInt() estimatedMinutes?: number;
  @IsOptional() @IsIn(["ADMIN_VERIFIED", "GOOGLE_ROUTES", "APPROXIMATE"]) distanceType?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() source?: string;
}
class CompetitorsDto { @IsArray() @IsString({ each: true }) projectIds!: string[]; }

class ProjectGateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) gateNumber?: number;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) masterPlanX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) masterPlanY?: number;
  @IsOptional() @IsString() googlePlaceId?: string;
  @IsOptional() @IsBoolean() isMain?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsString() notes?: string;
}
class GateLocationDto {
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) masterPlanX?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) masterPlanY?: number;
  @IsIn(["GPS_MANUAL", "MASTER_PLAN_MANUAL", "IMPORT"]) source!: string;
  @IsOptional() @IsBoolean() confirmed?: boolean;
}
type BoundaryPoint = { lat: number; lng: number };
class ProjectBoundaryDto {
  @IsArray() points!: BoundaryPoint[];
  @IsIn(["GPS_MANUAL", "MAP_DRAWN", "IMPORT"]) source!: string;
}
class ProjectZoneDto {
  @IsString() name!: string;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() notes?: string;
}
class ProjectBuildingDto {
  @IsString() name!: string;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @IsString() zoneId?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @IsString() notes?: string;
}
class UnitInternalLocationDto {
  @IsOptional() @IsString() projectZoneId?: string;
  @IsOptional() @IsString() projectBuildingId?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @Type(() => Number) @IsNumber() latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() longitude?: number;
  @IsOptional() @IsString() internalLocationDescription?: string;
}
class UnitProximityDto {
  @IsIn(["GATE", "AMENITY", "LANDMARK", "PROJECT_CENTER"]) targetType!: string;
  @IsOptional() @IsString() gateId?: string;
  @IsOptional() @IsString() amenityId?: string;
  @IsOptional() @IsString() landmarkId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) distanceMeters?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) walkingMinutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) drivingMinutes?: number;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsBoolean() verified?: boolean;
  @IsOptional() @IsString() notes?: string;
}

class UnitMasterPlanLocationDto {
  @IsIn(["SUGGEST", "CONFIRM", "REJECT", "CLEAR"]) action!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) x?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) y?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) confidence?: number;
  @IsOptional() @IsIn(["AI_VISION", "ADMIN_MANUAL", "IMPORT"]) source?: string;
}
class GateMasterPlanLocationDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) x!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) y!: number;
}
class MasterPlanCalibrationDto {
  @IsArray() anchors!: Array<{ x:number; y:number; latitude:number; longitude:number }>;
}
class BuildingMasterPlanLocationDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) x!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) y!: number;
}
class BulkMasterPlanAssignmentDto {
  @IsArray() @IsString({ each: true }) unitIds!: string[];
  @IsOptional() @IsString() buildingId?: string;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) x!: number;
  @Type(() => Number) @IsNumber() @Min(0) @Max(1) y!: number;
}

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/real-estate")
export class RealEstateController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly cache: ApplicationCache) {}

  private async geoFromMasterPlan(projectId: string, x: number, y: number) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { masterPlanCalibration: true } });
    const raw = project.masterPlanCalibration as any;
    const anchors = Array.isArray(raw?.anchors) ? raw.anchors : [];
    if (anchors.length < 3) return null;
    try {
      return calibrateMasterPlan(anchors.map((anchor:any) => ({ x:Number(anchor.x), y:Number(anchor.y), latitude:Number(anchor.latitude), longitude:Number(anchor.longitude) })))({ x, y });
    } catch { return null; }
  }
  private async readinessFor(projectId: string, pending: Record<string, unknown> = {}) {
    const [project, imageCount, phaseCount, paymentPlanCount, marketProfileCount, unassignedUnitCount] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { location: true, amenities: { where: { verified: true } } } }),
      this.prisma.media.count({ where: { projectId, type: "IMAGE", phaseId: null } }),
      this.prisma.projectPhase.count({ where: { projectId } }),
      this.prisma.paymentPlan.count({ where: { projectId, phaseId: null, unitId: null, isActive: true } }),
      this.prisma.marketProfile.count({ where: { projectId } }),
      this.prisma.unit.count({ where: { projectId, archivedAt: null, phaseId: null } }),
    ]);
    const value = { ...project, ...pending } as Record<string, any>;
    const missing: string[] = [];
    if (!value.canonicalName && !value.nameAr && !value.nameEn) missing.push("canonical identity");
    if (!value.locationId) missing.push("location");
    if (!(value.latitude && value.longitude) && !(project.location?.latitude && project.location?.longitude)) missing.push("coordinates");
    if (!value.shortDescriptionAr && !value.shortDescriptionEn && !value.shortDescription) missing.push("short description");
    if (!(Array.isArray(value.projectTypes) && value.projectTypes.length) && !value.projectType) missing.push("project type");
    if (!phaseCount) missing.push("at least one phase");
    if (!paymentPlanCount) missing.push("project default payment plan");
    if (!project.amenities.length) missing.push("verified amenities");
    if (unassignedUnitCount) missing.push(`assign ${unassignedUnitCount} active unit${unassignedUnitCount === 1 ? "" : "s"} to a phase`);
    if (imageCount < 3) missing.push("at least 3 project images");
    const warnings = marketProfileCount ? [] : ["market profiles are still empty; investment/resale/rental answers will stay limited to verified inventory facts"];
    return { ready: missing.length === 0, missing, warnings, imageCount, phaseCount, unassignedUnitCount, marketProfileCount };
  }

  @Get("dashboard") async dashboard() {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [
      units,
      availableUnits,
      reservedUnits,
      soldUnits,
      unavailableUnits,
      projects,
      developers,
      activeImports,
      importsNeedingInput,
      newLeads,
      followUps,
      mappedUnits,
      projectsWithBoundary,
      activePaymentPlans,
      pendingKnowledge,
      conversations24h,
    ] = await this.prisma.$transaction([
      this.prisma.unit.count({ where: { archivedAt: null } }),
      this.prisma.unit.count({ where: { archivedAt: null, status: "AVAILABLE" } }),
      this.prisma.unit.count({ where: { archivedAt: null, status: "RESERVED" } }),
      this.prisma.unit.count({ where: { archivedAt: null, status: "SOLD" } }),
      this.prisma.unit.count({ where: { archivedAt: null, status: "UNAVAILABLE" } }),
      this.prisma.project.count({ where: { adminStatus: { not: "ARCHIVED" } } }),
      this.prisma.developer.count(),
      this.prisma.dataImport.count({ where: { status: { in: ["UPLOADED", "ANALYZING", "READY", "IMPORTING"] } } }),
      this.prisma.dataImport.count({ where: { status: "NEEDS_INPUT" } }),
      this.prisma.lead.count({ where: { status: "NEW" } }),
      this.prisma.lead.count({ where: { followUpAt: { lte: new Date() }, status: { notIn: ["WON", "LOST"] } } }),
      this.prisma.unit.count({ where: { archivedAt: null, masterPlanLocationStatus: { in: ["CONFIRMED", "BUILDING_CONFIRMED"] } } }),
      this.prisma.project.count({ where: { adminStatus: { not: "ARCHIVED" }, boundaryConfirmedAt: { not: null } } }),
      this.prisma.paymentPlan.count({ where: { isActive: true } }),
      this.prisma.projectKnowledgeItem.count({ where: { approvalStatus: "PENDING" } }),
      this.prisma.conversation.count({ where: { updatedAt: { gte: since24h } } }),
    ]);
    return {
      units,
      availableUnits,
      reservedUnits,
      soldUnits,
      unavailableUnits,
      projects,
      developers,
      activeImports,
      importsNeedingInput,
      newLeads,
      followUps,
      mappedUnits,
      projectsWithBoundary,
      activePaymentPlans,
      pendingKnowledge,
      conversations24h,
    };
  }

  @Get("developers/:id") developer(@Param("id") id: string) {
    return this.prisma.developer.findUniqueOrThrow({ where: { id }, include: { portfolioProjects: { include: { location: true, verifiedBy: { select: { id: true, name: true } } }, orderBy: [{ deliveryYear: "desc" }, { projectName: "asc" }] }, projects: { select: { id: true, name: true, nameAr: true, nameEn: true, adminStatus: true, projectStatus: true } }, media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] }, documents: { orderBy: { createdAt: "desc" } }, _count: { select: { units: true, projects: true } } } });
  }

  @Patch("developers/:id") async updateDeveloper(@Param("id") id: string, @Body() body: DeveloperDetailsDto, @Req() req: any) {
    const item = await this.prisma.developer.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "DEVELOPER_DETAILS_UPDATED", "Developer", id, { fields: Object.keys(body) });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Post("developers/:id/portfolio") async createPortfolio(@Param("id") developerId: string, @Body() body: PortfolioDto, @Req() req: any) {
    const item = await this.prisma.developerProjectPortfolio.create({ data: { ...body, developerId, verifiedAt: new Date(), verifiedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_CREATED", "DeveloperProjectPortfolio", item.id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("portfolio/:id") async updatePortfolio(@Param("id") id: string, @Body() body: PortfolioDto, @Req() req: any) {
    const item = await this.prisma.developerProjectPortfolio.update({ where: { id }, data: { ...body, verifiedAt: new Date(), verifiedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_UPDATED", "DeveloperProjectPortfolio", id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("portfolio/:id") async deletePortfolio(@Param("id") id: string, @Req() req: any) {
    await this.prisma.developerProjectPortfolio.delete({ where: { id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_DELETED", "DeveloperProjectPortfolio", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Get("projects/:id") project(@Param("id") id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id }, include: { developer: true, location: { include: { parent: true, aliases: true } }, amenities: { include: { amenity: true } }, gates: { include: { phase: true }, orderBy: [{ isMain: "desc" }, { gateNumber: "asc" }, { name: "asc" }] }, phases: { include: { _count: { select: { units: true, buildings: true, gates: true } } }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, zones: { include: { phase: true, buildings: { include: { phase: true }, orderBy: { name: "asc" } } }, orderBy: { name: "asc" } }, buildings: { include: { zone: true, phase: true }, orderBy: { name: "asc" } }, investmentProfile: true, marketProfiles: { orderBy: [{ segment: "asc" }, { propertyUse: "asc" }] }, landmarks: { include: { location: true }, orderBy: { name: "asc" } }, competitorsFrom: { include: { competitorProject: { include: { developer: true, location: true } } } }, media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] }, documents: { orderBy: { createdAt: "desc" } }, paymentPlans: { where: { isActive: true }, orderBy: [{ durationMonths: "asc" }, { name: "asc" }] }, knowledgeItems: { where: { approvalStatus: "APPROVED" }, orderBy: { category: "asc" } }, _count: { select: { units: true, knowledgeItems: true } } } });
  }
  @Get("projects/:id/readiness") readiness(@Param("id") id: string) { return this.readinessFor(id); }
  @Patch("projects/:id") async updateProject(@Param("id") id: string, @Body() body: ProjectDetailsDto, @Req() req: any) {
    if (body.adminStatus === "READY_FOR_CUSTOMER") {
      const readiness = await this.readinessFor(id, body as Record<string, unknown>);
      if (!readiness.ready) throw new BadRequestException({ code: "PROJECT_NOT_CUSTOMER_READY", message: "المشروع غير جاهز للنشر. راجع المتطلبات الناقصة الظاهرة في الرسالة.", missing: readiness.missing });
    }
    const { launchDate, deliveryDate, ...rest } = body;
    const item = await this.prisma.project.update({ where: { id }, data: { ...rest, launchDate: launchDate ? new Date(launchDate) : undefined, deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined } });
    await this.audit.record(req.admin.id, "PROJECT_DETAILS_UPDATED", "Project", id, { fields: Object.keys(body) });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("projects/:id/investment") async investment(@Param("id") projectId: string, @Body() body: InvestmentDto, @Req() req: any) {
    const data = { ...body, verifiedAt: new Date(), verifiedByAdminId: req.admin.id };
    const item = await this.prisma.projectInvestmentProfile.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await this.audit.record(req.admin.id, "PROJECT_INVESTMENT_UPDATED", "ProjectInvestmentProfile", item.id, { fields: Object.keys(body) });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Get("amenities") amenities() { return this.prisma.amenity.findMany({ orderBy: [{ category: "asc" }, { canonicalName: "asc" }] }); }
  @Post("amenities") async createAmenity(@Body() body: AmenityDto, @Req() req: any) {
    const item = await this.prisma.amenity.upsert({ where: { canonicalName: body.canonicalName }, create: body, update: body });
    await this.audit.record(req.admin.id, "AMENITY_SAVED", "Amenity", item.id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("projects/:id/amenities") async setAmenities(@Param("id") projectId: string, @Body() body: ProjectAmenityDto, @Req() req: any) {
    await this.prisma.$transaction(async tx => { await tx.projectAmenity.deleteMany({ where: { projectId } }); if (body.amenityIds.length) await tx.projectAmenity.createMany({ data: body.amenityIds.map(amenityId => ({ projectId, amenityId, verified: true, source: "ADMIN" })) }); });
    await this.audit.record(req.admin.id, "PROJECT_AMENITIES_SET", "Project", projectId, { count: body.amenityIds.length });
    this.cache.invalidateCustomerData();
    return { saved: true };
  }
  @Post("projects/:id/landmarks") async createLandmark(@Param("id") projectId: string, @Body() body: LandmarkDto, @Req() req: any) {
    const item = await this.prisma.projectLandmark.create({ data: { ...body, projectId, verifiedAt: body.distanceType === "ADMIN_VERIFIED" || !body.distanceType ? new Date() : undefined } });
    await this.audit.record(req.admin.id, "PROJECT_LANDMARK_CREATED", "ProjectLandmark", item.id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("landmarks/:id") async deleteLandmark(@Param("id") id: string, @Req() req: any) {
    await this.prisma.projectLandmark.delete({ where: { id } });
    await this.audit.record(req.admin.id, "PROJECT_LANDMARK_DELETED", "ProjectLandmark", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }
  @Patch("projects/:id/competitors") async competitors(@Param("id") projectId: string, @Body() body: CompetitorsDto, @Req() req: any) {
    const ids = body.projectIds.filter(id => id !== projectId);
    await this.prisma.$transaction(async tx => { await tx.projectCompetitor.deleteMany({ where: { projectId } }); if (ids.length) await tx.projectCompetitor.createMany({ data: ids.map(competitorProjectId => ({ projectId, competitorProjectId, verified: true, source: "ADMIN" })) }); });
    await this.audit.record(req.admin.id, "PROJECT_COMPETITORS_SET", "Project", projectId, { count: ids.length });
    this.cache.invalidateCustomerData();
    return { saved: true };
  }

  @Get("projects/:id/gates") gates(@Param("id") projectId: string) {
    return this.prisma.projectGate.findMany({ where: { projectId }, orderBy: [{ isMain: "desc" }, { gateNumber: "asc" }, { name: "asc" }] });
  }
  @Post("projects/:id/gates") async createGate(@Param("id") projectId: string, @Body() body: ProjectGateDto, @Req() req: any) {
    if (body.isMain) await this.prisma.projectGate.updateMany({ where: { projectId }, data: { isMain: false } });
    const hasGps = body.latitude != null && body.longitude != null;
    const hasPlan = body.masterPlanX != null && body.masterPlanY != null;
    const item = await this.prisma.projectGate.create({ data: { ...body, projectId, locationSource: hasGps ? "GPS_MANUAL" : hasPlan ? "MASTER_PLAN_MANUAL" : undefined, confirmedAt: hasGps || hasPlan ? new Date() : undefined, confirmedByAdminId: hasGps || hasPlan ? req.admin.id : undefined } });
    await this.audit.record(req.admin.id, "PROJECT_GATE_CREATED", "ProjectGate", item.id, { projectId });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("gates/:id") async updateGate(@Param("id") id: string, @Body() body: ProjectGateDto, @Req() req: any) {
    const current = await this.prisma.projectGate.findUniqueOrThrow({ where: { id } });
    if (body.isMain) await this.prisma.projectGate.updateMany({ where: { projectId: current.projectId, id: { not: id } }, data: { isMain: false } });
    const item = await this.prisma.projectGate.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "PROJECT_GATE_UPDATED", "ProjectGate", id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("gates/:id") async deleteGate(@Param("id") id: string, @Req() req: any) {
    await this.prisma.projectGate.delete({ where: { id } });
    await this.audit.record(req.admin.id, "PROJECT_GATE_DELETED", "ProjectGate", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Patch("gates/:id/location") async setGateLocation(@Param("id") id: string, @Body() body: GateLocationDto, @Req() req: any) {
    if (body.source === "GPS_MANUAL" && (body.latitude == null || body.longitude == null)) throw new BadRequestException("Latitude and longitude are required for GPS gate location.");
    if (body.source === "MASTER_PLAN_MANUAL" && (body.masterPlanX == null || body.masterPlanY == null)) throw new BadRequestException("Master-plan x and y are required.");
    const item = await this.prisma.projectGate.update({
      where: { id },
      data: {
        latitude: body.latitude,
        longitude: body.longitude,
        masterPlanX: body.masterPlanX,
        masterPlanY: body.masterPlanY,
        locationSource: body.source,
        confirmedAt: body.confirmed === false ? null : new Date(),
        confirmedByAdminId: body.confirmed === false ? null : req.admin.id,
      },
    });
    await this.audit.record(req.admin.id, "PROJECT_GATE_LOCATION_SET", "ProjectGate", id, { source: body.source, confirmed: body.confirmed !== false });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Get("projects/:id/boundary") async boundary(@Param("id") projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true, boundaryGeoJson: true, boundarySource: true, boundaryConfirmedAt: true } });
    return project;
  }

  @Patch("projects/:id/boundary") async setBoundary(@Param("id") projectId: string, @Body() body: ProjectBoundaryDto, @Req() req: any) {
    if (!Array.isArray(body.points) || body.points.length < 3) throw new BadRequestException("Project boundary requires at least 3 GPS points.");
    const points = body.points.map((point, index) => {
      const lat = Number((point as any)?.lat);
      const lng = Number((point as any)?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new BadRequestException(`Invalid GPS boundary point at index ${index}.`);
      return { lat, lng };
    });
    const ring = [...points.map(point => [point.lng, point.lat]), [points[0].lng, points[0].lat]];
    const geoJson = { type: "Polygon", coordinates: [ring] } as Prisma.InputJsonValue;
    // The project center follows the drawn boundary so admins never need to type
    // latitude/longitude just to make project location and map features work.
    const latitude = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
    const longitude = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
    const item = await this.prisma.project.update({ where: { id: projectId }, data: { boundaryGeoJson: geoJson, boundarySource: body.source, boundaryConfirmedAt: new Date(), boundaryConfirmedByAdminId: req.admin.id, latitude, longitude } });
    await this.audit.record(req.admin.id, "PROJECT_BOUNDARY_CONFIRMED", "Project", projectId, { pointCount: points.length, source: body.source });
    this.cache.invalidateCustomerData();
    return { id: item.id, boundaryGeoJson: item.boundaryGeoJson, boundarySource: item.boundarySource, boundaryConfirmedAt: item.boundaryConfirmedAt };
  }

  @Delete("projects/:id/boundary") async clearBoundary(@Param("id") projectId: string, @Req() req: any) {
    await this.prisma.project.update({ where: { id: projectId }, data: { boundaryGeoJson: Prisma.JsonNull, boundarySource: null, boundaryConfirmedAt: null, boundaryConfirmedByAdminId: null, latitude: null, longitude: null } });
    await this.audit.record(req.admin.id, "PROJECT_BOUNDARY_CLEARED", "Project", projectId);
    this.cache.invalidateCustomerData();
    return { cleared: true };
  }

  @Get("projects/:id/master-plan/calibration") async masterPlanCalibration(@Param("id") projectId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { masterPlanCalibration: true } });
    return project.masterPlanCalibration ?? { anchors: [] };
  }

  @Patch("projects/:id/master-plan/calibration") async setMasterPlanCalibration(@Param("id") projectId: string, @Body() body: MasterPlanCalibrationDto, @Req() req: any) {
    const anchors = (body.anchors ?? []).map((anchor:any) => ({ x:Number(anchor.x), y:Number(anchor.y), latitude:Number(anchor.latitude), longitude:Number(anchor.longitude) }));
    if (anchors.length < 3 || anchors.some((a:any) => !Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(a.latitude) || !Number.isFinite(a.longitude) || a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1 || a.latitude < -90 || a.latitude > 90 || a.longitude < -180 || a.longitude > 180)) throw new BadRequestException("المعايرة تحتاج 3 نقاط صحيحة على الأقل.");
    try { calibrateMasterPlan(anchors); } catch { throw new BadRequestException("نقاط المعايرة غير صالحة أو على خط واحد."); }
    const value = { anchors, confirmedAt: new Date().toISOString(), confirmedByAdminId: req.admin.id };
    await this.prisma.project.update({ where: { id: projectId }, data: { masterPlanCalibration: value } });
    await this.audit.record(req.admin.id, "PROJECT_MASTER_PLAN_CALIBRATED", "Project", projectId, { anchorCount: anchors.length });
    this.cache.invalidateCustomerData();
    return value;
  }

  @Post("projects/:id/zones") async createZone(@Param("id") projectId: string, @Body() body: ProjectZoneDto, @Req() req: any) {
    const item = await this.prisma.projectZone.create({ data: { ...body, projectId } });
    await this.audit.record(req.admin.id, "PROJECT_ZONE_CREATED", "ProjectZone", item.id, { projectId });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("zones/:id") async updateZone(@Param("id") id: string, @Body() body: ProjectZoneDto, @Req() req: any) {
    const item = await this.prisma.projectZone.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "PROJECT_ZONE_UPDATED", "ProjectZone", id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("zones/:id") async deleteZone(@Param("id") id: string, @Req() req: any) {
    await this.prisma.projectZone.delete({ where: { id } });
    await this.audit.record(req.admin.id, "PROJECT_ZONE_DELETED", "ProjectZone", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Post("projects/:id/buildings") async createBuilding(@Param("id") projectId: string, @Body() body: ProjectBuildingDto, @Req() req: any) {
    if (body.zoneId) {
      const zone = await this.prisma.projectZone.findFirst({ where: { id: body.zoneId, projectId } });
      if (!zone) throw new BadRequestException("المنطقة الداخلية لا تتبع هذا المشروع.");
    }
    const item = await this.prisma.projectBuilding.create({ data: { ...body, projectId } });
    await this.audit.record(req.admin.id, "PROJECT_BUILDING_CREATED", "ProjectBuilding", item.id, { projectId });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("buildings/:id") async updateBuilding(@Param("id") id: string, @Body() body: ProjectBuildingDto, @Req() req: any) {
    const current = await this.prisma.projectBuilding.findUniqueOrThrow({ where: { id } });
    if (body.zoneId) {
      const zone = await this.prisma.projectZone.findFirst({ where: { id: body.zoneId, projectId: current.projectId } });
      if (!zone) throw new BadRequestException("المنطقة الداخلية لا تتبع هذا المشروع.");
    }
    const item = await this.prisma.projectBuilding.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "PROJECT_BUILDING_UPDATED", "ProjectBuilding", id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("buildings/:id") async deleteBuilding(@Param("id") id: string, @Req() req: any) {
    await this.prisma.projectBuilding.delete({ where: { id } });
    await this.audit.record(req.admin.id, "PROJECT_BUILDING_DELETED", "ProjectBuilding", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Patch("buildings/:id/master-plan-location") async setBuildingMasterPlanLocation(@Param("id") id: string, @Body() body: BuildingMasterPlanLocationDto, @Req() req: any) {
    const building = await this.prisma.projectBuilding.findUniqueOrThrow({ where: { id }, select: { id: true, projectId: true } });
    const geo = await this.geoFromMasterPlan(building.projectId, body.x, body.y);
    const item = await this.prisma.projectBuilding.update({ where: { id }, data: { masterPlanX: body.x, masterPlanY: body.y, latitude: geo?.latitude, longitude: geo?.longitude, masterPlanLocationSource: geo ? "MASTER_PLAN_CALIBRATED" : "MASTER_PLAN_MANUAL", masterPlanConfirmedAt: new Date(), masterPlanConfirmedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "BUILDING_MASTER_PLAN_LOCATION_UPDATED", "ProjectBuilding", id, { x: body.x, y: body.y, gpsDerived: Boolean(geo) });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Patch("projects/:id/master-plan/bulk-assign") async bulkAssignMasterPlan(@Param("id") projectId: string, @Body() body: BulkMasterPlanAssignmentDto, @Req() req: any) {
    const ids = [...new Set(body.unitIds ?? [])];
    if (!ids.length) throw new BadRequestException("اختر وحدة واحدة على الأقل.");
    const count = await this.prisma.unit.count({ where: { id: { in: ids }, projectId } });
    if (count !== ids.length) throw new BadRequestException("بعض الوحدات لا تتبع هذا المشروع.");
    if (body.buildingId) {
      const building = await this.prisma.projectBuilding.findFirst({ where: { id: body.buildingId, projectId } });
      if (!building) throw new BadRequestException("المبنى لا يتبع هذا المشروع.");
    }
    const geo = await this.geoFromMasterPlan(projectId, body.x, body.y);
    const result = await this.prisma.unit.updateMany({ where: { id: { in: ids }, projectId }, data: { projectBuildingId: body.buildingId ?? undefined, masterPlanX: body.x, masterPlanY: body.y, latitude: geo?.latitude, longitude: geo?.longitude, masterPlanLocationStatus: "CONFIRMED", masterPlanLocationSource: geo ? "MASTER_PLAN_CALIBRATED" : "ADMIN_MANUAL", masterPlanConfidence: 1, masterPlanConfirmedAt: new Date(), masterPlanConfirmedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "UNITS_MASTER_PLAN_BULK_ASSIGNED", "Project", projectId, { count: result.count, buildingId: body.buildingId ?? null, x: body.x, y: body.y, gpsDerived: Boolean(geo) });
    this.cache.invalidateCustomerData();
    return { updated: result.count, latitude: geo?.latitude ?? null, longitude: geo?.longitude ?? null };
  }

  @Patch("units/:id/internal-location") async updateUnitInternalLocation(@Param("id") id: string, @Body() body: UnitInternalLocationDto, @Req() req: any) {
    const unit = await this.prisma.unit.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    if (body.projectZoneId) {
      const zone = await this.prisma.projectZone.findFirst({ where: { id: body.projectZoneId, projectId: unit.projectId } });
      if (!zone) throw new BadRequestException("المنطقة الداخلية لا تتبع مشروع الوحدة.");
    }
    if (body.projectBuildingId) {
      const building = await this.prisma.projectBuilding.findFirst({ where: { id: body.projectBuildingId, projectId: unit.projectId } });
      if (!building) throw new BadRequestException("المبنى لا يتبع مشروع الوحدة.");
    }
    const item = await this.prisma.unit.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "UNIT_INTERNAL_LOCATION_UPDATED", "Unit", id);
    this.cache.invalidateCustomerData();
    return item;
  }

  @Post("projects/:id/master-plan/locate-unit/:unitId") async locateUnitOnPlan(@Param("id") projectId: string, @Param("unitId") unitId: string, @Req() req: any) {
    const [unit, masterPlan] = await Promise.all([
      this.prisma.unit.findFirstOrThrow({ where: { id: unitId, projectId }, select: { id: true, externalUnitId: true } }),
      this.prisma.media.findFirst({ where: { projectId, type: "MASTER_PLAN" }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }] }),
    ]);
    if (!masterPlan) throw new BadRequestException({ code: "MASTER_PLAN_NOT_FOUND", message: "ارفع صورة Master Plan للمشروع أولاً." });
    const suggestion = await locateUnitOnMasterPlan(masterPlan.url, unit.externalUnitId);
    if (!suggestion.found || suggestion.x == null || suggestion.y == null) return { found: false, confidence: suggestion.confidence ?? 0, matchedLabel: suggestion.matchedLabel ?? null };
    const updated = await this.prisma.unit.update({
      where: { id: unit.id },
      data: { masterPlanX: suggestion.x, masterPlanY: suggestion.y, masterPlanLocationStatus: "SUGGESTED", masterPlanLocationSource: "AI_VISION", masterPlanConfidence: suggestion.confidence ?? null, masterPlanConfirmedAt: null, masterPlanConfirmedByAdminId: null },
    });
    await this.audit.record(req.admin.id, "UNIT_MASTER_PLAN_SUGGESTED", "Unit", unit.id, { projectId, confidence: suggestion.confidence ?? null, matchedLabel: suggestion.matchedLabel ?? null });
    this.cache.invalidateCustomerData();
    return { found: true, x: Number(updated.masterPlanX), y: Number(updated.masterPlanY), confidence: suggestion.confidence ?? null, matchedLabel: suggestion.matchedLabel ?? null };
  }

  @Patch("units/:id/master-plan-location") async setUnitMasterPlanLocation(@Param("id") id: string, @Body() body: UnitMasterPlanLocationDto, @Req() req: any) {
    const current = await this.prisma.unit.findUniqueOrThrow({ where: { id } });
    if ((body.action === "SUGGEST" || body.action === "CONFIRM") && (body.x == null || body.y == null)) throw new BadRequestException("x and y are required");
    const data = body.action === "CLEAR"
      ? { masterPlanX: null, masterPlanY: null, masterPlanLocationStatus: "UNLOCATED", masterPlanLocationSource: null, masterPlanConfidence: null, masterPlanConfirmedAt: null, masterPlanConfirmedByAdminId: null }
      : body.action === "REJECT"
        ? { masterPlanLocationStatus: "UNLOCATED", masterPlanLocationSource: null, masterPlanConfidence: null, masterPlanConfirmedAt: null, masterPlanConfirmedByAdminId: null }
        : body.action === "CONFIRM"
          ? { masterPlanX: body.x, masterPlanY: body.y, masterPlanLocationStatus: "CONFIRMED", masterPlanLocationSource: body.source ?? "ADMIN_MANUAL", masterPlanConfidence: body.confidence ?? current.masterPlanConfidence, masterPlanConfirmedAt: new Date(), masterPlanConfirmedByAdminId: req.admin.id }
          : { masterPlanX: body.x, masterPlanY: body.y, masterPlanLocationStatus: "SUGGESTED", masterPlanLocationSource: body.source ?? "ADMIN_MANUAL", masterPlanConfidence: body.confidence ?? null, masterPlanConfirmedAt: null, masterPlanConfirmedByAdminId: null };
    if (body.action === "CONFIRM" && body.x != null && body.y != null) {
      const geo = await this.geoFromMasterPlan(current.projectId, body.x, body.y);
      if (geo) Object.assign(data, { latitude: geo.latitude, longitude: geo.longitude, masterPlanLocationSource: body.source === "AI_VISION" ? "AI_VISION_CALIBRATED" : "MASTER_PLAN_CALIBRATED" });
    }
    const item = await this.prisma.unit.update({ where: { id }, data });
    await this.audit.record(req.admin.id, `UNIT_MASTER_PLAN_${body.action}`, "Unit", id, { x: body.x, y: body.y, source: body.source });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Patch("gates/:id/master-plan-location") async setGateMasterPlanLocation(@Param("id") id: string, @Body() body: GateMasterPlanLocationDto, @Req() req: any) {
    const gate = await this.prisma.projectGate.findUniqueOrThrow({ where: { id }, select: { projectId: true } });
    const geo = await this.geoFromMasterPlan(gate.projectId, body.x, body.y);
    const item = await this.prisma.projectGate.update({ where: { id }, data: { masterPlanX: body.x, masterPlanY: body.y, latitude: geo?.latitude, longitude: geo?.longitude, locationSource: geo ? "MASTER_PLAN_CALIBRATED" : "MASTER_PLAN_MANUAL", confirmedAt: new Date(), confirmedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "GATE_MASTER_PLAN_LOCATION_UPDATED", "ProjectGate", id, body);
    this.cache.invalidateCustomerData();
    return item;
  }

  @Get("units/:id/proximities") proximities(@Param("id") unitId: string) {
    return this.prisma.unitProximity.findMany({ where: { unitId }, include: { gate: true, amenity: true, landmark: true }, orderBy: [{ targetType: "asc" }, { distanceMeters: "asc" }] });
  }
  @Post("units/:id/proximities") async createProximity(@Param("id") unitId: string, @Body() body: UnitProximityDto, @Req() req: any) {
    const unit = await this.prisma.unit.findUniqueOrThrow({ where: { id: unitId }, select: { projectId: true } });
    const targetCount = [body.gateId, body.amenityId, body.landmarkId].filter(Boolean).length;
    if (body.targetType === "PROJECT_CENTER") { if (targetCount) throw new BadRequestException("PROJECT_CENTER لا يحتاج هدفاً إضافياً."); }
    else if (targetCount !== 1) throw new BadRequestException("اختر هدفاً واحداً فقط لقياس القرب.");
    if (body.gateId && !(await this.prisma.projectGate.findFirst({ where: { id: body.gateId, projectId: unit.projectId } }))) throw new BadRequestException("البوابة لا تتبع مشروع الوحدة.");
    if (body.landmarkId && !(await this.prisma.projectLandmark.findFirst({ where: { id: body.landmarkId, projectId: unit.projectId } }))) throw new BadRequestException("المعلم لا يتبع مشروع الوحدة.");
    const item = await this.prisma.unitProximity.create({ data: { ...body, unitId } });
    await this.audit.record(req.admin.id, "UNIT_PROXIMITY_CREATED", "UnitProximity", item.id, { unitId });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("proximities/:id") async deleteProximity(@Param("id") id: string, @Req() req: any) {
    await this.prisma.unitProximity.delete({ where: { id } });
    await this.audit.record(req.admin.id, "UNIT_PROXIMITY_DELETED", "UnitProximity", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }
}

