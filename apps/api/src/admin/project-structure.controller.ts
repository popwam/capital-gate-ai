import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { AuditService } from "../audit.service";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { ApplicationCache } from "../cache/application-cache";
import { PrismaService } from "../database/prisma.service";

const SCOPE_SEGMENTS = ["INVESTMENT", "RESALE", "RENTAL"] as const;
const PROPERTY_USES = ["RESIDENTIAL", "COMMERCIAL", "OFFICE", "RETAIL", "HOSPITALITY", "MIXED"] as const;

class PhaseDto {
  @IsString() name!: string;
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nameAr?: string;
  @IsOptional() @IsString() nameEn?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2200) launchYear?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2200) deliveryYear?: number;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) deliveryStatuses?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) projectTypes?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) constructionPercentage?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) unitTypes?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) finishingOptions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) customerFit?: string[];
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxArea?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minBedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) maxBedrooms?: number;
  @IsOptional() @IsString() descriptionAr?: string;
  @IsOptional() @IsString() descriptionEn?: string;
  @IsOptional() @IsString() deliveryNotesAr?: string;
  @IsOptional() @IsString() deliveryNotesEn?: string;
}

class PolygonDto {
  @IsArray() points!: Array<{ x: number; y: number }>;
}

class BuildingPolygonDto extends PolygonDto {
  @IsOptional() @IsString() phaseId?: string;
}

class MarketProfileDto {
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsIn([...SCOPE_SEGMENTS]) segment!: string;
  @IsIn([...PROPERTY_USES]) propertyUse!: string;
  @IsOptional() @IsString() suitability?: string;
  @IsOptional() @IsString() demand?: string;
  @IsOptional() @Type(() => Number) @IsNumber() yieldMin?: number;
  @IsOptional() @Type(() => Number) @IsNumber() yieldMax?: number;
  @IsOptional() @IsString() liquidity?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) targetCustomers?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) advantages?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) risks?: string[];
  @IsOptional() metrics?: Prisma.InputJsonValue;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsString() source?: string;
}

class ReviewAssignmentsDto {
  @IsArray() assignments!: Array<{ buildingId: string; unitIds: string[] }>;
}

function normalize(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function tokenScore(needle: string, values: Array<string | null | undefined>) {
  const n = normalize(needle);
  if (!n) return 0;
  const candidates = values.map(normalize).filter(Boolean);
  let score = 0;
  for (const candidate of candidates) {
    if (candidate === n) score = Math.max(score, 1);
    else if (candidate.includes(n) || n.includes(candidate)) score = Math.max(score, 0.9);
    const tokens = n.split(" ").filter((token) => token.length >= 2);
    const hits = tokens.filter((token) => candidate.includes(token)).length;
    if (tokens.length) score = Math.max(score, hits / tokens.length * 0.8);
  }
  return score;
}

@UseGuards(AdminAuthGuard)
@Controller("admin/real-estate")
export class ProjectStructureController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cache: ApplicationCache,
  ) {}

  @Get("projects/:id/phases")
  phases(@Param("id") projectId: string) {
    return this.prisma.projectPhase.findMany({
      where: { projectId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      include: {
        _count: { select: { units: true, buildings: true, gates: true, media: true, documents: true } },
        buildings: { orderBy: [{ name: "asc" }] },
        gates: { where: { isActive: true }, orderBy: [{ isMain: "desc" }, { gateNumber: "asc" }] },
        media: { where: { type: "IMAGE" }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
        documents: { where: { type: "BROCHURE" }, orderBy: { createdAt: "desc" } },
        paymentPlans: { where: { isActive: true }, orderBy: [{ planType: "asc" }, { durationMonths: "asc" }] },
        marketProfiles: { orderBy: [{ segment: "asc" }, { propertyUse: "asc" }] },
      },
    });
  }

  @Post("projects/:id/phases")
  async createPhase(@Param("id") projectId: string, @Body() body: PhaseDto, @Req() req: any) {
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
    const last = await this.prisma.projectPhase.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const item = await this.prisma.projectPhase.create({
      data: {
        projectId,
        ...body,
        sortOrder: body.sortOrder ?? (last._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record(req.admin.id, "PROJECT_PHASE_CREATED", "ProjectPhase", item.id, { projectId });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Post("projects/:id/phases/backfill")
  async backfillLegacyUnitPhases(@Param("id") projectId: string, @Req() req: any) {
    const [phases, units] = await Promise.all([
      this.prisma.projectPhase.findMany({ where: { projectId }, select: { id: true, code: true, name: true, nameAr: true, nameEn: true } }),
      this.prisma.unit.findMany({ where: { projectId, phaseId: null, archivedAt: null }, select: { id: true, phase: true, externalUnitId: true } }),
    ]);
    const groups = new Map<string, string[]>();
    const unmatched: string[] = [];
    for (const unit of units) {
      const legacy = normalize(unit.phase);
      const match = legacy ? phases.find((phase) => [phase.code, phase.name, phase.nameAr, phase.nameEn].filter(Boolean).some((value) => normalize(value) === legacy)) : null;
      if (!match) { unmatched.push(unit.externalUnitId); continue; }
      groups.set(match.id, [...(groups.get(match.id) ?? []), unit.id]);
    }
    let assigned = 0;
    for (const [phaseId, unitIds] of groups) {
      const result = await this.prisma.unit.updateMany({ where: { projectId, id: { in: unitIds }, phaseId: null }, data: { phaseId } });
      assigned += result.count;
    }
    await this.audit.record(req.admin.id, "LEGACY_UNIT_PHASES_BACKFILLED", "Project", projectId, { assigned, unmatched: unmatched.length });
    if (assigned) this.cache.invalidateCustomerData();
    return { assigned, unmatched: unmatched.length, unmatchedUnitCodes: unmatched.slice(0, 30) };
  }

  @Patch("phases/:id")
  async updatePhase(@Param("id") id: string, @Body() body: PhaseDto, @Req() req: any) {
    const item = await this.prisma.projectPhase.update({ where: { id }, data: body });
    await this.audit.record(req.admin.id, "PROJECT_PHASE_UPDATED", "ProjectPhase", id, { fields: Object.keys(body) });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Delete("phases/:id")
  async deletePhase(@Param("id") id: string, @Req() req: any) {
    const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id }, select: { projectId: true, _count: { select: { units: true } } } });
    if (phase._count.units > 0) throw new BadRequestException({ code: "PHASE_HAS_UNITS", message: "انقل الوحدات لمرحلة أخرى قبل حذف المرحلة." });
    await this.prisma.projectPhase.delete({ where: { id } });
    await this.audit.record(req.admin.id, "PROJECT_PHASE_DELETED", "ProjectPhase", id, { projectId: phase.projectId });
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Patch("phases/:id/master-plan-polygon")
  async phasePolygon(@Param("id") id: string, @Body() body: PolygonDto, @Req() req: any) {
    if (body.points.length < 3) throw new BadRequestException("Phase polygon needs at least 3 points");
    const points = body.points.map((point) => ({ x: Math.max(0, Math.min(1, Number(point.x))), y: Math.max(0, Math.min(1, Number(point.y))) }));
    const item = await this.prisma.projectPhase.update({ where: { id }, data: { masterPlanPolygon: points } });
    await this.audit.record(req.admin.id, "PROJECT_PHASE_POLYGON_UPDATED", "ProjectPhase", id, { pointCount: points.length });
    return item;
  }

  @Patch("buildings/:id/master-plan-polygon")
  async buildingPolygon(@Param("id") id: string, @Body() body: BuildingPolygonDto, @Req() req: any) {
    if (body.points.length < 3) throw new BadRequestException("Building polygon needs at least 3 points");
    const points = body.points.map((point) => ({ x: Math.max(0, Math.min(1, Number(point.x))), y: Math.max(0, Math.min(1, Number(point.y))) }));
    const item = await this.prisma.projectBuilding.update({ where: { id }, data: { masterPlanPolygon: points, ...(body.phaseId ? { phaseId: body.phaseId } : {}) } });
    await this.audit.record(req.admin.id, "PROJECT_BUILDING_POLYGON_UPDATED", "ProjectBuilding", id, { pointCount: points.length, phaseId: body.phaseId });
    return item;
  }

  @Get("projects/:id/market-profiles")
  marketProfiles(@Param("id") projectId: string, @Query("phaseId") phaseId?: string, @Query("unitId") unitId?: string) {
    return this.prisma.marketProfile.findMany({
      where: { projectId, ...(phaseId ? { phaseId } : {}), ...(unitId ? { unitId } : {}) },
      orderBy: [{ segment: "asc" }, { propertyUse: "asc" }, { updatedAt: "desc" }],
    });
  }

  @Post("projects/:id/market-profiles")
  async upsertMarketProfile(@Param("id") projectId: string, @Body() body: MarketProfileDto, @Req() req: any) {
    if (body.phaseId) {
      const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id: body.phaseId }, select: { projectId: true } });
      if (phase.projectId !== projectId) throw new BadRequestException("Phase does not belong to this project");
    }
    if (body.unitId) {
      const unit = await this.prisma.unit.findUniqueOrThrow({ where: { id: body.unitId }, select: { projectId: true } });
      if (unit.projectId !== projectId) throw new BadRequestException("Unit does not belong to this project");
    }
    const existing = await this.prisma.marketProfile.findFirst({
      where: {
        projectId,
        phaseId: body.phaseId ?? null,
        unitId: body.unitId ?? null,
        segment: body.segment,
        propertyUse: body.propertyUse,
      },
      orderBy: { updatedAt: "desc" },
    });
    const data = { ...body, projectId };
    const item = existing
      ? await this.prisma.marketProfile.update({ where: { id: existing.id }, data })
      : await this.prisma.marketProfile.create({ data });
    await this.audit.record(req.admin.id, "MARKET_PROFILE_UPSERTED", "MarketProfile", item.id, { projectId, phaseId: body.phaseId, unitId: body.unitId, segment: body.segment });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Delete("market-profiles/:id")
  async deleteMarketProfile(@Param("id") id: string, @Req() req: any) {
    await this.prisma.marketProfile.delete({ where: { id } });
    await this.audit.record(req.admin.id, "MARKET_PROFILE_DELETED", "MarketProfile", id);
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Get("projects/:id/master-plan/suggestions")
  async masterPlanSuggestions(@Param("id") projectId: string) {
    const [buildings, units] = await Promise.all([
      this.prisma.projectBuilding.findMany({ where: { projectId }, include: { phase: true }, orderBy: { name: "asc" } }),
      this.prisma.unit.findMany({
        where: { projectId, archivedAt: null },
        select: { id: true, externalUnitId: true, building: true, phase: true, phaseId: true, projectBuildingId: true },
        orderBy: { externalUnitId: "asc" },
      }),
    ]);
    return buildings.map((building) => {
      const candidates = units
        .map((unit) => {
          if (unit.projectBuildingId === building.id) return { ...unit, confidence: 1, reason: "already_assigned" };
          const score = Math.max(
            tokenScore(building.code ?? "", [unit.building, unit.externalUnitId]),
            tokenScore(building.name, [unit.building, unit.externalUnitId]),
            tokenScore(building.nameAr ?? "", [unit.building, unit.externalUnitId]),
            tokenScore(building.nameEn ?? "", [unit.building, unit.externalUnitId]),
          );
          const phaseBoost = building.phaseId && (unit.phaseId === building.phaseId || tokenScore(building.phase?.name ?? "", [unit.phase]) > 0.7) ? 0.08 : 0;
          return { ...unit, confidence: Math.min(0.99, score + phaseBoost), reason: score > 0 ? "name_match" : "no_match" };
        })
        .filter((unit) => unit.confidence >= 0.58)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 250);
      return {
        building: { id: building.id, name: building.name, nameAr: building.nameAr, code: building.code, phaseId: building.phaseId },
        candidates,
        highConfidenceCount: candidates.filter((unit) => unit.confidence >= 0.82).length,
      };
    });
  }

  @Patch("projects/:id/master-plan/review")
  async reviewAssignments(@Param("id") projectId: string, @Body() body: ReviewAssignmentsDto, @Req() req: any) {
    let assigned = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const assignment of body.assignments) {
        const building = await tx.projectBuilding.findUniqueOrThrow({ where: { id: assignment.buildingId }, select: { projectId: true, phaseId: true, name: true } });
        if (building.projectId !== projectId) throw new BadRequestException("Building does not belong to project");
        const result = await tx.unit.updateMany({
          where: { id: { in: assignment.unitIds }, projectId },
          data: {
            projectBuildingId: assignment.buildingId,
            building: building.name,
            ...(building.phaseId ? { phaseId: building.phaseId } : {}),
            masterPlanLocationStatus: "BUILDING_CONFIRMED",
            masterPlanLocationSource: "AI_NAME_MATCH_REVIEWED",
            masterPlanConfirmedAt: new Date(),
            masterPlanConfirmedByAdminId: req.admin.id,
          },
        });
        assigned += result.count;
      }
    });
    await this.audit.record(req.admin.id, "MASTER_PLAN_AI_ASSIGNMENTS_REVIEWED", "Project", projectId, { assigned, groups: body.assignments.length });
    this.cache.invalidateCustomerData();
    return { assigned };
  }
}
