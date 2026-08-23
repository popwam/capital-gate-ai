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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentType, MediaType, Prisma, UnitStatus } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit.service";
import { StorageService } from "../storage/storage.service";
import { ApplicationCache } from "../cache/application-cache";

class DeveloperDto {
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(180) slug!: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateDeveloperDto {
  @IsOptional() @IsString() @MaxLength(160) name?: string;
  @IsOptional() @IsString() @MaxLength(180) slug?: string;
  @IsOptional() @IsString() description?: string;
}
class ProjectDto {
  @IsString() developerId!: string;
  @IsString() @MaxLength(180) name!: string;
  @IsString() @MaxLength(200) slug!: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() shortDescription?: string;
  @IsOptional() @IsString() description?: string;
}
class UpdateProjectDto {
  @IsOptional() @IsString() developerId?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() locationId?: string;
  @IsOptional() @IsString() shortDescription?: string;
  @IsOptional() @IsString() description?: string;
}
class CreateUnitDto {
  @IsOptional() @IsString() externalUnitId?: string;
  @IsString() developerId!: string;
  @IsString() projectId!: string;
  @IsString() phaseId!: string;
  @IsOptional() @IsString() projectBuildingId?: string;
  @IsOptional() @IsString() projectZoneId?: string;
  @IsOptional() @IsString() phase?: string;
  @IsOptional() @IsString() building?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() unitSubType?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) builtUpArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) landArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
  @IsOptional() @IsBoolean() isResale?: boolean;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsString() finishingType?: string;
}
class UpdateUnitDto {
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() developerId?: string;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() projectBuildingId?: string;
  @IsOptional() @IsString() projectZoneId?: string;
  @IsOptional() @IsString() phase?: string;
  @IsOptional() @IsString() building?: string;
  @IsOptional() @IsString() floor?: string;
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() unitSubType?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) builtUpArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) landArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
  @IsOptional() @IsBoolean() isResale?: boolean;
  @IsOptional() @IsDateString() deliveryDate?: string;
  @IsOptional() @IsString() finishingType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) downPayment?: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  installmentYears?: number;
}
class BulkUnitDto {
  @IsArray() @IsString({ each: true }) unitIds!: string[];
  @IsIn([
    "MARK_AVAILABLE",
    "MARK_RESERVED",
    "MARK_SOLD",
    "MARK_UNAVAILABLE",
    "ARCHIVE",
    "ASSIGN_PROJECT",
    "CHANGE_DELIVERY",
    "DELETE_SAFE",
  ])
  action!: string;
  @IsOptional() @IsString() value?: string;
  @IsString() confirmation!: string;
}
class PaymentPlanDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @Type(() => Number) @IsNumber() downPayment?: number;
  @IsOptional() @Type(() => Number) @IsNumber() installmentYears?: number;
  @IsOptional() @Type(() => Number) @IsNumber() installmentAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(360) durationMonths?: number;
  @IsOptional() @Type(() => Number) @IsNumber() downPaymentAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() downPaymentPercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalPrice?: number;
  @IsOptional() @Type(() => Number) @IsNumber() totalPriceOverride?: number;
  @IsOptional() @Type(() => Number) @IsNumber() discountAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() discountPercent?: number;
  @IsOptional() @IsIn(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL", "CUSTOM"]) installmentFrequency?: string;
  @IsOptional() @IsIn(["EGP", "USD", "EUR", "AED", "SAR", "GBP", "QAR", "KWD", "BHD", "OMR"]) currency?: string;
  @IsOptional() @Type(() => Number) @IsNumber() maintenanceAmount?: number;
  @IsOptional() @Type(() => Number) @IsNumber() maintenancePercent?: number;
  @IsOptional() @IsIn(["CASH", "INSTALLMENT"]) planType?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) reservationAmount?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(5475) durationValue?: number;
  @IsOptional() @IsIn(["DAY", "MONTH", "YEAR"]) durationUnit?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) installmentEveryValue?: number;
  @IsOptional() @IsIn(["DAY", "MONTH", "YEAR"]) installmentEveryUnit?: string;
  @IsOptional() @IsIn(["SAME_CYCLE", "NEXT_MONTH", "NEXT_CYCLE", "AFTER_DELAY"]) firstInstallmentTiming?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) firstInstallmentAfterValue?: number;
  @IsOptional() @IsIn(["DAY", "MONTH", "YEAR"]) firstInstallmentAfterUnit?: string;
  @IsOptional() @IsIn(["EQUAL", "CUSTOM"]) distributionMode?: string;
  @IsOptional() @IsArray() percentageSchedule?: Array<{ label?: string; percent: number; sequence?: number }>;
  @IsOptional() @IsDateString() validFrom?: string;
  @IsOptional() @IsDateString() validTo?: string;
  @IsOptional() @IsString() notes?: string;
}
class OfferDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() discountAmount?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}
class UpdateOfferDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @Type(() => Number) @IsNumber() discountAmount?: number;
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsDateString() endsAt?: string;
}
class MediaDto {
  @IsEnum(MediaType) type!: MediaType;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() developerId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() altText?: string;
  @IsOptional() @IsString() altTextAr?: string;
  @IsOptional() @IsString() altTextEn?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsIn(["GALLERY", "UNIT_MATCH"]) purpose?: string;
}
class UnitMediaRuleUploadDto {
  @IsString() projectId!: string;
  @IsString() phaseId!: string;
  @IsIn(["IMAGE", "FLOOR_PLAN"]) type!: "IMAGE" | "FLOOR_PLAN";
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() unitSubType?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minBuiltUpArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maxBuiltUpArea?: number;
  @IsOptional() @Type(() => Number) @IsInt() priority?: number;
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsString() altTextAr?: string;
}

class DocumentDto {
  @IsEnum(DocumentType) type!: DocumentType;
  @IsOptional() @IsString() phaseId?: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() developerId?: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsString() source?: string;
}
class ReorderMediaDto {
  @IsArray() items!: Array<{ id: string; sortOrder: number }>;
  @IsOptional() @IsString() coverId?: string;
}
class UpdateMediaDto {
  @IsOptional() @IsString() altText?: string;
  @IsOptional() @IsString() altTextAr?: string;
  @IsOptional() @IsString() altTextEn?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isCover?: boolean;
}

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/catalog")
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly cache: ApplicationCache,
  ) {}
  @Get("developers") developers() {
    return this.prisma.developer.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { projects: true, units: true } } },
    });
  }
  @Post("developers") async createDeveloper(
    @Body() body: DeveloperDto,
    @Req() req: any,
  ) {
    const existing = await this.prisma.developer.findFirst({ where: { name: { equals: body.name.trim(), mode: "insensitive" } } });
    if (existing) return existing;
    const item = await this.prisma.developer.create({ data: body });
    await this.audit.record(
      req.admin.id,
      "DEVELOPER_CREATED",
      "Developer",
      item.id,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("developers/:id") async updateDeveloper(
    @Param("id") id: string,
    @Body() body: UpdateDeveloperDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.developer.update({
      where: { id },
      data: body,
    });
    await this.audit.record(
      req.admin.id,
      "DEVELOPER_UPDATED",
      "Developer",
      id,
      body,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Get("projects") projects() {
    return this.prisma.project.findMany({
      include: {
        developer: true,
        location: true,
        _count: { select: { units: true, knowledgeItems: true } },
      },
      orderBy: { name: "asc" },
    });
  }
  @Get("projects/:id") project(@Param("id") id: string) {
    return this.prisma.project.findUniqueOrThrow({
      where: { id },
      include: {
        developer: true,
        location: true,
        media: true,
        documents: true,
        amenities: { include: { amenity: true } },
        investmentProfile: true,
        landmarks: true,
        competitorsFrom: { include: { competitorProject: true } },
        paymentPlans: { where: { isActive: true }, orderBy: [{ durationMonths: "asc" }, { name: "asc" }] },
        _count: { select: { units: true, knowledgeItems: true } },
      },
    });
  }
  @Post("projects") async createProject(
    @Body() body: ProjectDto,
    @Req() req: any,
  ) {
    const existing = await this.prisma.project.findFirst({ where: { developerId: body.developerId, name: { equals: body.name.trim(), mode: "insensitive" } } });
    if (existing) return existing;
    const item = await this.prisma.project.create({ data: body });
    await this.audit.record(
      req.admin.id,
      "PROJECT_CREATED",
      "Project",
      item.id,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("projects/:id") async updateProject(
    @Param("id") id: string,
    @Body() body: UpdateProjectDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.project.update({
      where: { id },
      data: body,
    });
    await this.audit.record(
      req.admin.id,
      "PROJECT_UPDATED",
      "Project",
      id,
      body,
    );
    this.cache.invalidateCustomerData();
    return item;
  }

  @Post("units") async createUnit(@Body() body: CreateUnitDto, @Req() req: any) {
    const [project, phase, building] = await Promise.all([
      this.prisma.project.findUniqueOrThrow({ where: { id: body.projectId }, select: { developerId: true } }),
      body.phaseId ? this.prisma.projectPhase.findUniqueOrThrow({ where: { id: body.phaseId }, select: { projectId: true, name: true } }) : Promise.resolve(null),
      body.projectBuildingId ? this.prisma.projectBuilding.findUniqueOrThrow({ where: { id: body.projectBuildingId }, select: { projectId: true, phaseId: true, name: true } }) : Promise.resolve(null),
    ]);
    if (project.developerId !== body.developerId) throw new BadRequestException("Developer does not own the selected project");
    if (phase && phase.projectId !== body.projectId) throw new BadRequestException("Phase does not belong to the selected project");
    if (building && building.projectId !== body.projectId) throw new BadRequestException("Building does not belong to the selected project");
    if (building?.phaseId && building.phaseId !== body.phaseId) throw new BadRequestException("Building does not belong to the selected phase");
    const item = await this.prisma.unit.create({
      data: {
        ...body,
        externalUnitId: body.externalUnitId?.trim() || `MANUAL-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        currency: body.currency || "EGP",
        deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : undefined,
        phase: body.phase || phase?.name,
        building: body.building || building?.name,
        phaseId: body.phaseId || building?.phaseId || undefined,
      },
      include: { project: true, developer: true, phaseRef: true, projectBuilding: true },
    });
    if (body.price != null) await this.prisma.unitPriceHistory.create({ data: { unitId: item.id, price: body.price, currency: body.currency || "EGP" } });
    await this.audit.record(req.admin.id, "UNIT_CREATED_MANUALLY", "Unit", item.id, { projectId: body.projectId, phaseId: item.phaseId });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Get("units") async units(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.UnitWhereInput = {};
    if (query.developerId) where.developerId = query.developerId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.phaseId) where.phaseId = query.phaseId;
    if (query.sourceImportId) where.OR = [{ sourceImportId: query.sourceImportId }, { importChanges: { some: { importId: query.sourceImportId } } }];
    if (
      query.status &&
      Object.values(UnitStatus).includes(query.status as UnitStatus)
    )
      where.status = query.status as UnitStatus;
    if (query.unitType)
      where.unitType = { contains: query.unitType, mode: "insensitive" };
    if (query.isResale === "true" || query.isResale === "false")
      where.isResale = query.isResale === "true";
    if (query.unitCode)
      where.externalUnitId = { contains: query.unitCode, mode: "insensitive" };
    if (query.bedrooms) where.bedrooms = Number(query.bedrooms);
    if (query.minPrice || query.maxPrice)
      where.price = {
        gte: query.minPrice ? Number(query.minPrice) : undefined,
        lte: query.maxPrice ? Number(query.maxPrice) : undefined,
      };
    if (query.locationId) where.project = { locationId: query.locationId };
    if (query.archived !== "true") where.archivedAt = null;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.unit.findMany({
        where,
        include: {
          project: { include: { location: true } },
          developer: true,
          phaseRef: true,
          projectBuilding: true,
          projectZone: true,
          sourceImport: { select: { id: true, name: true, fileName: true } },
          paymentPlans: { where: { isActive: true } },
          offers: { where: { isActive: true } },
        },
        orderBy: { updatedAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.unit.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }
  @Get("units/:id") unit(@Param("id") id: string) {
    return this.prisma.unit.findUniqueOrThrow({
      where: { id },
      include: {
        project: true,
        developer: true,
        phaseRef: true,
        projectBuilding: true,
        projectZone: true,
        paymentPlans: true,
        offers: true,
        media: true,
        marketProfiles: { orderBy: [{ segment: "asc" }, { propertyUse: "asc" }] },
        priceHistory: { orderBy: { effectiveAt: "desc" } },
        importChanges: {
          include: {
            import: {
              select: {
                id: true,
                name: true,
                fileName: true,
                uploadedAt: true,
              },
            },
          },
          orderBy: { appliedAt: "desc" },
        },
      },
    });
  }
  @Patch("units/:id") async updateUnit(
    @Param("id") id: string,
    @Body() body: UpdateUnitDto,
    @Req() req: any,
  ) {
    const prior = await this.prisma.unit.findUniqueOrThrow({ where: { id } });
    const data = {
      ...body,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : undefined,
      availabilityUpdatedAt:
        body.status && body.status !== prior.status ? new Date() : undefined,
    };
    const item = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.unit.update({ where: { id }, data });
      if (
        body.price != null &&
        String(prior.price ?? "") !== String(body.price)
      )
        await tx.unitPriceHistory.create({
          data: {
            unitId: id,
            price: body.price,
            currency: body.currency || prior.currency || "EGP",
          },
        });
      return updated;
    });
    await this.audit.record(req.admin.id, "UNIT_UPDATED", "Unit", id, {
      fields: Object.keys(body),
      priceChanged:
        body.price != null && String(prior.price ?? "") !== String(body.price),
    });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Post("units/bulk") async bulkUnits(
    @Body() body: BulkUnitDto,
    @Req() req: any,
  ) {
    if (!body.unitIds.length || body.unitIds.length > 500)
      throw new BadRequestException("Select between 1 and 500 units");
    if (body.confirmation !== `CONFIRM ${body.unitIds.length}`)
      throw new BadRequestException(
        `Type CONFIRM ${body.unitIds.length} to continue`,
      );
    let data: Prisma.UnitUncheckedUpdateManyInput = {};
    if (body.action.startsWith("MARK_"))
      data = {
        status: body.action.replace("MARK_", "") as UnitStatus,
        availabilityUpdatedAt: new Date(),
      };
    else if (body.action === "ARCHIVE") data = { archivedAt: new Date() };
    else if (body.action === "CHANGE_DELIVERY") {
      if (!body.value)
        throw new BadRequestException("Delivery date is required");
      data = { deliveryDate: new Date(body.value) };
    } else if (body.action === "ASSIGN_PROJECT") {
      if (!body.value) throw new BadRequestException("Project is required");
      data = { projectId: body.value };
    } else if (body.action === "DELETE_SAFE") {
      const blocked = await this.prisma.unit.count({
        where: {
          id: { in: body.unitIds },
          OR: [{ media: { some: {} } }, { importChanges: { some: {} } }],
        },
      });
      if (blocked)
        throw new BadRequestException(
          `${blocked} selected units have media or import provenance and cannot be deleted safely. Archive them instead.`,
        );
      const deleted = await this.prisma.unit.deleteMany({
        where: { id: { in: body.unitIds } },
      });
      await this.audit.record(
        req.admin.id,
        "UNITS_BULK_DELETED",
        "Unit",
        undefined,
        { count: deleted.count },
      );
      this.cache.invalidateCustomerData();
      return deleted;
    }
    const result = await this.prisma.unit.updateMany({
      where: { id: { in: body.unitIds } },
      data,
    });
    await this.audit.record(
      req.admin.id,
      "UNITS_BULK_UPDATED",
      "Unit",
      undefined,
      { action: body.action, count: result.count },
    );
    this.cache.invalidateCustomerData();
    return result;
  }

  @Post("units/:id/payment-plans") async paymentPlan(
    @Param("id") unitId: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.paymentPlan.create({
      data: { ...body, validFrom: body.validFrom ? new Date(body.validFrom) : undefined, validTo: body.validTo ? new Date(body.validTo) : undefined, unitId },
    });
    await this.audit.record(
      req.admin.id,
      "PAYMENT_PLAN_CREATED",
      "PaymentPlan",
      item.id,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Post("projects/:id/payment-plans") async projectPaymentPlan(
    @Param("id") projectId: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    await this.prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
    // Project-wide plans are percentage/rule based. The unit's inventory price remains the source price.
    const forbiddenAmountFields = [body.totalPrice, body.totalPriceOverride, body.discountAmount, body.installmentAmount, body.downPaymentAmount, body.downPayment, body.maintenanceAmount];
    if (forbiddenAmountFields.some(value => value != null)) throw new BadRequestException({ code: "PAYMENT_PLAN_AMOUNT_NOT_ALLOWED", message: "خطة المشروع تعتمد على النسب والفترات فقط. المبلغ الوحيد المسموح هنا هو مبلغ الحجز." });
    const planType = body.planType ?? "INSTALLMENT";
    const percentageSchedule = Array.isArray(body.percentageSchedule) ? body.percentageSchedule.map((row, index) => ({ label: String(row?.label ?? `دفعة ${index + 1}`).slice(0, 80), percent: Number(row?.percent ?? 0), sequence: Number(row?.sequence ?? index + 1) })) : [];
    if (percentageSchedule.some(row => !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100)) throw new BadRequestException({ code: "PAYMENT_PLAN_INVALID_PERCENTAGE", message: "نسب دفعات السداد غير صالحة." });
    const distributionMode = body.distributionMode ?? "EQUAL";
    if (planType === "INSTALLMENT" && distributionMode === "CUSTOM") {
      const total = Number(body.downPaymentPercent ?? 0) + percentageSchedule.reduce((sum, row) => sum + row.percent, 0);
      if (Math.abs(total - 100) > 0.001) throw new BadRequestException({ code: "PAYMENT_PLAN_PERCENTAGE_TOTAL", message: `إجمالي المقدم والدفعات يجب أن يساوي 100%. الإجمالي الحالي ${total.toFixed(2)}%.` });
    }
    const normalized = planType === "CASH" ? { ...body, planType, distributionMode: "EQUAL", durationMonths: 0, durationValue: 0, durationUnit: "MONTH", downPaymentPercent: 100, installmentFrequency: undefined, installmentEveryValue: undefined, installmentEveryUnit: undefined, firstInstallmentTiming: undefined, firstInstallmentAfterValue: undefined, firstInstallmentAfterUnit: undefined, percentageSchedule: [] } : { ...body, planType, distributionMode, percentageSchedule: distributionMode === "CUSTOM" ? percentageSchedule : [] };
    const item = await this.prisma.paymentPlan.create({
      data: { ...normalized, validFrom: body.validFrom ? new Date(body.validFrom) : undefined, validTo: body.validTo ? new Date(body.validTo) : undefined, projectId },
    });
    await this.audit.record(req.admin.id, "PROJECT_PAYMENT_PLAN_CREATED", "PaymentPlan", item.id, { projectId });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Post("phases/:id/payment-plans") async phasePaymentPlan(
    @Param("id") phaseId: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id: phaseId }, select: { projectId: true } });
    const forbiddenAmountFields = [body.totalPrice, body.totalPriceOverride, body.discountAmount, body.installmentAmount, body.downPaymentAmount, body.downPayment, body.maintenanceAmount];
    if (forbiddenAmountFields.some(value => value != null)) throw new BadRequestException({ code: "PAYMENT_PLAN_AMOUNT_NOT_ALLOWED", message: "خطة المرحلة تعتمد على النسب والفترات فقط. المبلغ الوحيد المسموح هنا هو مبلغ الحجز." });
    const planType = body.planType ?? "INSTALLMENT";
    const distributionMode = body.distributionMode ?? "EQUAL";
    const percentageSchedule = Array.isArray(body.percentageSchedule) ? body.percentageSchedule.map((row, index) => ({ label: String(row?.label ?? `دفعة ${index + 1}`).slice(0, 80), percent: Number(row?.percent ?? 0), sequence: Number(row?.sequence ?? index + 1) })) : [];
    if (planType === "INSTALLMENT" && distributionMode === "CUSTOM") {
      const total = Number(body.downPaymentPercent ?? 0) + percentageSchedule.reduce((sum, row) => sum + row.percent, 0);
      if (Math.abs(total - 100) > 0.001) throw new BadRequestException({ code: "PAYMENT_PLAN_PERCENTAGE_TOTAL", message: `إجمالي المقدم والدفعات يجب أن يساوي 100%. الإجمالي الحالي ${total.toFixed(2)}%.` });
    }
    const normalized = planType === "CASH"
      ? { ...body, planType, distributionMode: "EQUAL", durationMonths: 0, durationValue: 0, durationUnit: "MONTH", downPaymentPercent: 100, percentageSchedule: [] }
      : { ...body, planType, distributionMode, percentageSchedule: distributionMode === "CUSTOM" ? percentageSchedule : [] };
    const item = await this.prisma.paymentPlan.create({ data: { ...normalized, phaseId, projectId: phase.projectId, validFrom: body.validFrom ? new Date(body.validFrom) : undefined, validTo: body.validTo ? new Date(body.validTo) : undefined } });
    await this.audit.record(req.admin.id, "PHASE_PAYMENT_PLAN_CREATED", "PaymentPlan", item.id, { phaseId, projectId: phase.projectId });
    this.cache.invalidateCustomerData();
    return item;
  }

  @Patch("payment-plans/:id") async updatePlan(
    @Param("id") id: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.paymentPlan.update({
      where: { id },
      data: { ...body, validFrom: body.validFrom ? new Date(body.validFrom) : undefined, validTo: body.validTo ? new Date(body.validTo) : undefined },
    });
    await this.audit.record(
      req.admin.id,
      "PAYMENT_PLAN_UPDATED",
      "PaymentPlan",
      id,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("payment-plans/:id") async removePlan(
    @Param("id") id: string,
    @Req() req: any,
  ) {
    await this.prisma.paymentPlan.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.record(
      req.admin.id,
      "PAYMENT_PLAN_ARCHIVED",
      "PaymentPlan",
      id,
    );
    this.cache.invalidateCustomerData();
    return { archived: true };
  }
  @Post("units/:id/offers") async offer(
    @Param("id") unitId: string,
    @Body() body: OfferDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.offer.create({
      data: {
        ...body,
        startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
        endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
        unitId,
      },
    });
    await this.audit.record(req.admin.id, "OFFER_CREATED", "Offer", item.id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("offers/:id") async updateOffer(@Param("id") id: string, @Body() body: UpdateOfferDto, @Req() req: any) {
    const item = await this.prisma.offer.update({ where: { id }, data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : undefined, endsAt: body.endsAt ? new Date(body.endsAt) : undefined } });
    await this.audit.record(req.admin.id, "OFFER_UPDATED", "Offer", id);
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("offers/:id") async removeOffer(@Param("id") id: string, @Req() req: any) {
    await this.prisma.offer.update({ where: { id }, data: { isActive: false } });
    await this.audit.record(req.admin.id, "OFFER_ARCHIVED", "Offer", id);
    this.cache.invalidateCustomerData();
    return { archived: true };
  }

  @Get("media") mediaList(@Query("projectId") projectId?: string, @Query("unitId") unitId?: string, @Query("phaseId") phaseId?: string) {
    return this.prisma.media.findMany({ where: { projectId: projectId || undefined, unitId: unitId || undefined, phaseId: phaseId || undefined }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  }
  @Get("documents") documentList(@Query("projectId") projectId?: string, @Query("phaseId") phaseId?: string) {
    return this.prisma.document.findMany({ where: { projectId: projectId || undefined, phaseId: phaseId || undefined }, orderBy: { createdAt: "desc" } });
  }

  @Post("media")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async media(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: MediaDto,
    @Req() req: any,
  ) {
    if (!file || !file.mimetype.startsWith("image/"))
      throw new BadRequestException("A valid image is required");
    if (!body.developerId && !body.projectId && !body.unitId)
      throw new BadRequestException("developerId, projectId or unitId is required");
    if (body.phaseId && !body.projectId) throw new BadRequestException("phaseId requires projectId");
    if (body.phaseId && body.projectId) {
      const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id: body.phaseId }, select: { projectId: true } });
      if (phase.projectId !== body.projectId) throw new BadRequestException("Phase does not belong to project");
    }
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
      body.unitId ? "units" : body.projectId ? "projects" : "developers",
    );
    let sortOrder = 0;
    let isCover = false;
    if (body.projectId && body.type === MediaType.IMAGE) {
      const aggregate = await this.prisma.media.aggregate({ where: { projectId: body.projectId, phaseId: body.phaseId ?? null, type: MediaType.IMAGE }, _max: { sortOrder: true }, _count: { id: true } });
      sortOrder = (aggregate._max.sortOrder ?? -1) + 1;
      isCover = aggregate._count.id === 0;
    }
    const item = await this.prisma.media.create({
      data: {
        type: body.type,
        url: stored.url,
        storageKey: stored.key,
        altText: body.altText,
        altTextAr: body.altTextAr,
        altTextEn: body.altTextEn,
        caption: body.caption,
        purpose: body.purpose ?? "GALLERY",
        developerId: body.developerId,
        projectId: body.projectId,
        phaseId: body.phaseId,
        unitId: body.unitId,
        sortOrder,
        isCover,
      },
    });
    await this.audit.record(req.admin.id, "MEDIA_UPLOADED", "Media", item.id);
    this.cache.invalidateCustomerData();
    return item;
  }

  @Get("media-rules")
  mediaRules(@Query("projectId") projectId: string, @Query("phaseId") phaseId?: string) {
    if (!projectId) throw new BadRequestException("projectId is required");
    return this.prisma.unitMediaRule.findMany({
      where: { projectId, ...(phaseId ? { phaseId } : {}), isActive: true },
      include: { media: true, phase: { select: { id: true, name: true, nameAr: true, nameEn: true } } },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  @Post("media-rules/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  async uploadMediaRule(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UnitMediaRuleUploadDto,
    @Req() req: any,
  ) {
    if (!file || !file.mimetype.startsWith("image/")) throw new BadRequestException("A valid image is required");
    if (body.minBuiltUpArea != null && body.maxBuiltUpArea != null && body.minBuiltUpArea > body.maxBuiltUpArea)
      throw new BadRequestException("أقل مساحة لا يمكن أن تكون أكبر من أعلى مساحة.");
    const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id: body.phaseId }, select: { projectId: true } });
    if (phase.projectId !== body.projectId) throw new BadRequestException("Phase does not belong to project");
    const stored = await this.storage.put(file.buffer, file.originalname, file.mimetype, "unit-media-rules");
    const result = await this.prisma.$transaction(async (tx) => {
      const media = await tx.media.create({
        data: {
          projectId: body.projectId,
          phaseId: body.phaseId,
          type: body.type as MediaType,
          purpose: "UNIT_MATCH",
          url: stored.url,
          storageKey: stored.key,
          altTextAr: body.altTextAr,
          sortOrder: 0,
          isCover: false,
        },
      });
      const rule = await tx.unitMediaRule.create({
        data: {
          projectId: body.projectId,
          phaseId: body.phaseId,
          mediaId: media.id,
          unitType: body.unitType?.trim() || null,
          unitSubType: body.unitSubType?.trim() || null,
          bedrooms: body.bedrooms,
          bathrooms: body.bathrooms,
          minBuiltUpArea: body.minBuiltUpArea,
          maxBuiltUpArea: body.maxBuiltUpArea,
          priority: body.priority ?? 0,
          label: body.label?.trim() || null,
        },
        include: { media: true, phase: { select: { id: true, name: true, nameAr: true, nameEn: true } } },
      });
      return rule;
    }).catch(async (error) => {
      await this.storage.delete(stored.key).catch(() => undefined);
      throw error;
    });
    await this.audit.record(req.admin.id, "UNIT_MEDIA_RULE_CREATED", "UnitMediaRule", result.id, { projectId: body.projectId, phaseId: body.phaseId });
    this.cache.invalidateCustomerData();
    return result;
  }

  @Delete("media-rules/:id")
  async deleteMediaRule(@Param("id") id: string, @Req() req: any) {
    const rule = await this.prisma.unitMediaRule.findUniqueOrThrow({ where: { id }, include: { media: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.unitMediaRule.delete({ where: { id } });
      const otherRules = await tx.unitMediaRule.count({ where: { mediaId: rule.mediaId } });
      if (!otherRules && rule.media.purpose === "UNIT_MATCH") await tx.media.delete({ where: { id: rule.mediaId } });
    });
    if (rule.media.storageKey) await this.storage.delete(rule.media.storageKey).catch(() => undefined);
    await this.audit.record(req.admin.id, "UNIT_MEDIA_RULE_DELETED", "UnitMediaRule", id, { projectId: rule.projectId, phaseId: rule.phaseId });
    this.cache.invalidateCustomerData();
    return { deleted: true };
  }

  @Post("documents")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }),
  )
  async document(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: DocumentDto,
    @Req() req: any,
  ) {
    if (!body.projectId && !body.developerId)
      throw new BadRequestException("projectId or developerId is required");
    if (body.projectId) {
      if (body.type !== DocumentType.BROCHURE) throw new BadRequestException("Project and phase documents are brochure-only in Cg Ai.");
      if (!file || file.mimetype !== "application/pdf") throw new BadRequestException("Project brochures must be PDF files.");
      if (body.phaseId) {
        const phase = await this.prisma.projectPhase.findUniqueOrThrow({ where: { id: body.phaseId }, select: { projectId: true } });
        if (phase.projectId !== body.projectId) throw new BadRequestException("Phase does not belong to project");
      }
    } else if (
      !file ||
      ![
        "application/pdf",
        "text/plain",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ].includes(file.mimetype)
    )
      throw new BadRequestException("A PDF, DOCX or text document is required");
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
      "documents",
    );
    const item = await this.prisma.document.create({
      data: {
        type: body.type,
        name: file.originalname,
        url: stored.url,
        storageKey: stored.key,
        mimeType: file.mimetype,
        projectId: body.projectId,
        phaseId: body.phaseId,
        developerId: body.developerId,
        language: body.language,
        source: body.source,
      },
    });
    await this.audit.record(
      req.admin.id,
      "DOCUMENT_UPLOADED",
      "Document",
      item.id,
    );
    this.cache.invalidateCustomerData();
    return item;
  }
  @Patch("projects/:id/media/order") async reorderProjectMedia(@Param("id") projectId: string, @Body() body: ReorderMediaDto, @Req() req: any) {
    const ids = body.items.map((item) => item.id);
    const rows = await this.prisma.media.findMany({ where: { id: { in: ids }, projectId, type: "IMAGE", purpose: "GALLERY" }, select: { id: true, phaseId: true } });
    if (rows.length !== ids.length) throw new BadRequestException("One or more media items do not belong to the project image gallery");
    await this.prisma.$transaction(async (tx) => {
      for (const item of body.items) await tx.media.update({ where: { id: item.id }, data: { sortOrder: item.sortOrder, isCover: item.id === body.coverId } });
      if (body.coverId) {
        const cover = rows.find((row) => row.id === body.coverId);
        await tx.media.updateMany({ where: { projectId, phaseId: cover?.phaseId ?? null, type: "IMAGE", purpose: "GALLERY", id: { not: body.coverId } }, data: { isCover: false } });
        await tx.media.update({ where: { id: body.coverId }, data: { sortOrder: 0, isCover: true } });
      }
    });
    await this.audit.record(req.admin.id, "PROJECT_MEDIA_REORDERED", "Project", projectId, { count: body.items.length, coverId: body.coverId });
    this.cache.invalidateCustomerData();
    return this.prisma.media.findMany({ where: { projectId, type: "IMAGE", purpose: "GALLERY" }, orderBy: [{ phaseId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] });
  }

  @Patch("media/:id") async updateMedia(@Param("id") id: string, @Body() body: UpdateMediaDto, @Req() req: any) {
    const current = await this.prisma.media.findUniqueOrThrow({ where: { id } });
    const item = await this.prisma.$transaction(async tx => {
      if (body.isCover) await tx.media.updateMany({ where: { id: { not: id }, developerId: current.developerId, projectId: current.projectId, phaseId: current.phaseId, unitId: current.unitId }, data: { isCover: false } });
      return tx.media.update({ where: { id }, data: body });
    });
    await this.audit.record(req.admin.id, "MEDIA_UPDATED", "Media", id, { fields: Object.keys(body) });
    this.cache.invalidateCustomerData();
    return item;
  }
  @Delete("media/:id") async removeMedia(@Param("id") id: string, @Req() req: any) {
    await this.prisma.media.delete({ where: { id } });
    await this.audit.record(req.admin.id, "MEDIA_RECORD_DELETED", "Media", id, { storageObjectRetained: true });
    this.cache.invalidateCustomerData();
    return { deleted: true, storageObjectRetained: true };
  }
  @Delete("documents/:id") async removeDocument(@Param("id") id: string, @Req() req: any) {
    await this.prisma.document.delete({ where: { id } });
    await this.audit.record(req.admin.id, "DOCUMENT_RECORD_DELETED", "Document", id, { storageObjectRetained: true });
    this.cache.invalidateCustomerData();
    return { deleted: true, storageObjectRetained: true };
  }
}
