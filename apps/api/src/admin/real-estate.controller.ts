import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsDateString, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, MaxLength, Min } from "class-validator";
import { AuditService } from "../audit.service";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { PrismaService } from "../database/prisma.service";

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
  @IsOptional() @IsString() deliveryInformation?: string;
  @IsOptional() @IsString() deliveryStatus?: string;
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

@UseGuards(AdminAuthGuard)
@Controller("admin/real-estate")
export class RealEstateController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}
  private async readinessFor(projectId: string, pending: Record<string, unknown> = {}) {
    const [project, imageCount] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { location: true, investmentProfile: true, amenities: { where: { verified: true } } } }),
      this.prisma.media.count({ where: { projectId, type: "IMAGE" } }),
    ]);
    const value = { ...project, ...pending } as Record<string, any>;
    const missing: string[] = [];
    if (!value.canonicalName && !value.nameAr && !value.nameEn) missing.push("canonical identity");
    if (!value.locationId) missing.push("location");
    if (!(value.latitude && value.longitude) && !(project.location?.latitude && project.location?.longitude)) missing.push("coordinates");
    if (!value.shortDescriptionAr && !value.shortDescriptionEn && !value.shortDescription) missing.push("short description");
    if (!value.projectType) missing.push("project type");
    if (!value.deliveryStatus && !value.deliveryInformation) missing.push("delivery information");
    if (!value.priceSummary) missing.push("price summary");
    if (!value.paymentSummary) missing.push("payment summary");
    if (!project.amenities.length) missing.push("verified amenities");
    if (!project.investmentProfile?.verifiedAt) missing.push("verified investment profile");
    if (imageCount < 3) missing.push("at least 3 project images");
    return { ready: missing.length === 0, missing, imageCount };
  }

  @Get("dashboard") async dashboard() {
    const [units, availableUnits, projects, developers, activeImports, importsNeedingInput, newLeads, followUps] = await this.prisma.$transaction([
      this.prisma.unit.count({ where: { archivedAt: null } }),
      this.prisma.unit.count({ where: { archivedAt: null, status: "AVAILABLE" } }),
      this.prisma.project.count({ where: { adminStatus: { not: "ARCHIVED" } } }),
      this.prisma.developer.count(),
      this.prisma.dataImport.count({ where: { status: { in: ["UPLOADED", "ANALYZING", "READY", "IMPORTING"] } } }),
      this.prisma.dataImport.count({ where: { status: "NEEDS_INPUT" } }),
      this.prisma.lead.count({ where: { status: "NEW" } }),
      this.prisma.lead.count({ where: { followUpAt: { lte: new Date() }, status: { notIn: ["WON", "LOST"] } } }),
    ]);
    return { units, availableUnits, projects, developers, activeImports, importsNeedingInput, newLeads, followUps };
  }

  @Get("developers/:id") developer(@Param("id") id: string) {
    return this.prisma.developer.findUniqueOrThrow({ where: { id }, include: { portfolioProjects: { include: { location: true, verifiedBy: { select: { id: true, name: true } } }, orderBy: [{ deliveryYear: "desc" }, { projectName: "asc" }] }, projects: { select: { id: true, name: true, nameAr: true, nameEn: true, adminStatus: true, projectStatus: true } }, media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] }, documents: { orderBy: { createdAt: "desc" } }, _count: { select: { units: true, projects: true } } } });
  }

  @Patch("developers/:id") async updateDeveloper(@Param("id") id: string, @Body() body: DeveloperDetailsDto, @Req() req: any) {
    const item = await this.prisma.developer.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "DEVELOPER_DETAILS_UPDATED", "Developer", id, { fields: Object.keys(body) });
    return item;
  }

  @Post("developers/:id/portfolio") async createPortfolio(@Param("id") developerId: string, @Body() body: PortfolioDto, @Req() req: any) {
    const item = await this.prisma.developerProjectPortfolio.create({ data: { ...body, developerId, verifiedAt: new Date(), verifiedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_CREATED", "DeveloperProjectPortfolio", item.id);
    return item;
  }
  @Patch("portfolio/:id") async updatePortfolio(@Param("id") id: string, @Body() body: PortfolioDto, @Req() req: any) {
    const item = await this.prisma.developerProjectPortfolio.update({ where: { id }, data: { ...body, verifiedAt: new Date(), verifiedByAdminId: req.admin.id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_UPDATED", "DeveloperProjectPortfolio", id);
    return item;
  }
  @Delete("portfolio/:id") async deletePortfolio(@Param("id") id: string, @Req() req: any) {
    await this.prisma.developerProjectPortfolio.delete({ where: { id } });
    await this.audit.record(req.admin.id, "DEVELOPER_PORTFOLIO_DELETED", "DeveloperProjectPortfolio", id);
    return { deleted: true };
  }

  @Get("projects/:id") project(@Param("id") id: string) {
    return this.prisma.project.findUniqueOrThrow({ where: { id }, include: { developer: true, location: { include: { parent: true, aliases: true } }, amenities: { include: { amenity: true } }, investmentProfile: true, landmarks: { include: { location: true }, orderBy: { name: "asc" } }, competitorsFrom: { include: { competitorProject: { include: { developer: true, location: true } } } }, media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] }, documents: { orderBy: { createdAt: "desc" } }, knowledgeItems: { where: { approvalStatus: "APPROVED" }, orderBy: { category: "asc" } }, _count: { select: { units: true, knowledgeItems: true } } } });
  }
  @Get("projects/:id/readiness") readiness(@Param("id") id: string) { return this.readinessFor(id); }
  @Patch("projects/:id") async updateProject(@Param("id") id: string, @Body() body: ProjectDetailsDto, @Req() req: any) {
    if (body.adminStatus === "READY_FOR_CUSTOMER") {
      const readiness = await this.readinessFor(id, body as Record<string, unknown>);
      if (!readiness.ready) throw new BadRequestException({ code: "PROJECT_NOT_CUSTOMER_READY", message: "Complete the verified project profile before publishing it to customers.", missing: readiness.missing });
    }
    const { launchDate, deliveryDate, ...rest } = body;
    const item = await this.prisma.project.update({ where: { id }, data: { ...rest, launchDate: launchDate ? new Date(launchDate) : undefined, deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined } });
    await this.audit.record(req.admin.id, "PROJECT_DETAILS_UPDATED", "Project", id, { fields: Object.keys(body) });
    return item;
  }
  @Patch("projects/:id/investment") async investment(@Param("id") projectId: string, @Body() body: InvestmentDto, @Req() req: any) {
    const data = { ...body, verifiedAt: new Date(), verifiedByAdminId: req.admin.id };
    const item = await this.prisma.projectInvestmentProfile.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await this.audit.record(req.admin.id, "PROJECT_INVESTMENT_UPDATED", "ProjectInvestmentProfile", item.id, { fields: Object.keys(body) });
    return item;
  }

  @Get("amenities") amenities() { return this.prisma.amenity.findMany({ orderBy: [{ category: "asc" }, { canonicalName: "asc" }] }); }
  @Post("amenities") async createAmenity(@Body() body: AmenityDto, @Req() req: any) {
    const item = await this.prisma.amenity.upsert({ where: { canonicalName: body.canonicalName }, create: body, update: body });
    await this.audit.record(req.admin.id, "AMENITY_SAVED", "Amenity", item.id);
    return item;
  }
  @Patch("projects/:id/amenities") async setAmenities(@Param("id") projectId: string, @Body() body: ProjectAmenityDto, @Req() req: any) {
    await this.prisma.$transaction(async tx => { await tx.projectAmenity.deleteMany({ where: { projectId } }); if (body.amenityIds.length) await tx.projectAmenity.createMany({ data: body.amenityIds.map(amenityId => ({ projectId, amenityId, verified: true, source: "ADMIN" })) }); });
    await this.audit.record(req.admin.id, "PROJECT_AMENITIES_SET", "Project", projectId, { count: body.amenityIds.length });
    return { saved: true };
  }
  @Post("projects/:id/landmarks") async createLandmark(@Param("id") projectId: string, @Body() body: LandmarkDto, @Req() req: any) {
    const item = await this.prisma.projectLandmark.create({ data: { ...body, projectId, verifiedAt: body.distanceType === "ADMIN_VERIFIED" || !body.distanceType ? new Date() : undefined } });
    await this.audit.record(req.admin.id, "PROJECT_LANDMARK_CREATED", "ProjectLandmark", item.id);
    return item;
  }
  @Delete("landmarks/:id") async deleteLandmark(@Param("id") id: string, @Req() req: any) { await this.prisma.projectLandmark.delete({ where: { id } }); await this.audit.record(req.admin.id, "PROJECT_LANDMARK_DELETED", "ProjectLandmark", id); return { deleted: true }; }
  @Patch("projects/:id/competitors") async competitors(@Param("id") projectId: string, @Body() body: CompetitorsDto, @Req() req: any) {
    const ids = body.projectIds.filter(id => id !== projectId);
    await this.prisma.$transaction(async tx => { await tx.projectCompetitor.deleteMany({ where: { projectId } }); if (ids.length) await tx.projectCompetitor.createMany({ data: ids.map(competitorProjectId => ({ projectId, competitorProjectId, verified: true, source: "ADMIN" })) }); });
    await this.audit.record(req.admin.id, "PROJECT_COMPETITORS_SET", "Project", projectId, { count: ids.length });
    return { saved: true };
  }
}
