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
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentType, MediaType, Prisma, UnitStatus } from "@prisma/client";
import { Type } from "class-transformer";
import {
  IsArray,
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
class UpdateUnitDto {
  @IsOptional() @IsString() unitType?: string;
  @IsOptional() @IsString() unitSubType?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) builtUpArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) landArea?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsEnum(UnitStatus) status?: UnitStatus;
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
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsString() unitId?: string;
  @IsOptional() @IsString() altText?: string;
}
class DocumentDto {
  @IsEnum(DocumentType) type!: DocumentType;
  @IsString() projectId!: string;
}

@UseGuards(AdminAuthGuard)
@Controller("admin/catalog")
export class CatalogController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
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
    const item = await this.prisma.developer.create({ data: body });
    await this.audit.record(
      req.admin.id,
      "DEVELOPER_CREATED",
      "Developer",
      item.id,
    );
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
        _count: { select: { units: true, knowledgeItems: true } },
      },
    });
  }
  @Post("projects") async createProject(
    @Body() body: ProjectDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.project.create({ data: body });
    await this.audit.record(
      req.admin.id,
      "PROJECT_CREATED",
      "Project",
      item.id,
    );
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
    return item;
  }

  @Get("units") async units(@Query() query: Record<string, string>) {
    const page = Math.max(1, Number(query.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 50));
    const where: Prisma.UnitWhereInput = {};
    if (query.developerId) where.developerId = query.developerId;
    if (query.projectId) where.projectId = query.projectId;
    if (query.sourceImportId) where.OR = [{ sourceImportId: query.sourceImportId }, { importChanges: { some: { importId: query.sourceImportId } } }];
    if (
      query.status &&
      Object.values(UnitStatus).includes(query.status as UnitStatus)
    )
      where.status = query.status as UnitStatus;
    if (query.unitType)
      where.unitType = { contains: query.unitType, mode: "insensitive" };
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
        paymentPlans: true,
        offers: true,
        media: true,
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
    return result;
  }

  @Post("units/:id/payment-plans") async paymentPlan(
    @Param("id") unitId: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.paymentPlan.create({
      data: { ...body, unitId },
    });
    await this.audit.record(
      req.admin.id,
      "PAYMENT_PLAN_CREATED",
      "PaymentPlan",
      item.id,
    );
    return item;
  }
  @Patch("payment-plans/:id") async updatePlan(
    @Param("id") id: string,
    @Body() body: PaymentPlanDto,
    @Req() req: any,
  ) {
    const item = await this.prisma.paymentPlan.update({
      where: { id },
      data: body,
    });
    await this.audit.record(
      req.admin.id,
      "PAYMENT_PLAN_UPDATED",
      "PaymentPlan",
      id,
    );
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
    return item;
  }
  @Patch("offers/:id") async updateOffer(@Param("id") id: string, @Body() body: UpdateOfferDto, @Req() req: any) {
    const item = await this.prisma.offer.update({ where: { id }, data: { ...body, startsAt: body.startsAt ? new Date(body.startsAt) : undefined, endsAt: body.endsAt ? new Date(body.endsAt) : undefined } });
    await this.audit.record(req.admin.id, "OFFER_UPDATED", "Offer", id);
    return item;
  }
  @Delete("offers/:id") async removeOffer(@Param("id") id: string, @Req() req: any) {
    await this.prisma.offer.update({ where: { id }, data: { isActive: false } });
    await this.audit.record(req.admin.id, "OFFER_ARCHIVED", "Offer", id);
    return { archived: true };
  }

  @Get("media") mediaList(@Query("projectId") projectId?: string, @Query("unitId") unitId?: string) {
    return this.prisma.media.findMany({ where: { projectId: projectId || undefined, unitId: unitId || undefined }, orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] });
  }
  @Get("documents") documentList(@Query("projectId") projectId?: string) {
    return this.prisma.document.findMany({ where: { projectId: projectId || undefined }, orderBy: { createdAt: "desc" } });
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
    if (!body.projectId && !body.unitId)
      throw new BadRequestException("projectId or unitId is required");
    const stored = await this.storage.put(
      file.buffer,
      file.originalname,
      file.mimetype,
      body.unitId ? "units" : "projects",
    );
    const item = await this.prisma.media.create({
      data: {
        type: body.type,
        url: stored.url,
        altText: body.altText,
        projectId: body.projectId,
        unitId: body.unitId,
      },
    });
    await this.audit.record(req.admin.id, "MEDIA_UPLOADED", "Media", item.id);
    return item;
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
    if (
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
        mimeType: file.mimetype,
        projectId: body.projectId,
      },
    });
    await this.audit.record(
      req.admin.id,
      "DOCUMENT_UPLOADED",
      "Document",
      item.id,
    );
    return item;
  }
  @Delete("media/:id") async removeMedia(@Param("id") id: string, @Req() req: any) {
    await this.prisma.media.delete({ where: { id } });
    await this.audit.record(req.admin.id, "MEDIA_RECORD_DELETED", "Media", id, { storageObjectRetained: true });
    return { deleted: true, storageObjectRetained: true };
  }
  @Delete("documents/:id") async removeDocument(@Param("id") id: string, @Req() req: any) {
    await this.prisma.document.delete({ where: { id } });
    await this.audit.record(req.admin.id, "DOCUMENT_RECORD_DELETED", "Document", id, { storageObjectRetained: true });
    return { deleted: true, storageObjectRetained: true };
  }
}
