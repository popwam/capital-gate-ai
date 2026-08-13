import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { DocumentType, MediaType } from "@prisma/client";
import { IsEnum, IsOptional, IsString } from "class-validator";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { PrismaService } from "../database/prisma.service";
import { AuditService } from "../audit.service";
import { StorageService } from "../storage/storage.service";

class DeveloperDto { @IsString() name!: string; @IsString() slug!: string; @IsOptional() @IsString() description?: string; }
class ProjectDto { @IsString() developerId!: string; @IsString() name!: string; @IsString() slug!: string; @IsOptional() @IsString() locationId?: string; @IsOptional() @IsString() shortDescription?: string; @IsOptional() @IsString() description?: string; }
class MediaDto { @IsEnum(MediaType) type!: MediaType; @IsOptional() @IsString() projectId?: string; @IsOptional() @IsString() unitId?: string; @IsOptional() @IsString() altText?: string; }
class DocumentDto { @IsEnum(DocumentType) type!: DocumentType; @IsString() projectId!: string; }

@UseGuards(AdminAuthGuard)
@Controller("admin/catalog")
export class CatalogController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService) {}
  @Get("developers") developers() { return this.prisma.developer.findMany({ orderBy: { name: "asc" } }); }
  @Post("developers") async createDeveloper(@Body() body: DeveloperDto, @Req() req: any) { const item = await this.prisma.developer.create({ data: body }); await this.audit.record(req.admin.id, "DEVELOPER_CREATED", "Developer", item.id); return item; }
  @Get("projects") projects() { return this.prisma.project.findMany({ include: { developer: true, location: true }, orderBy: { name: "asc" } }); }
  @Post("projects") async createProject(@Body() body: ProjectDto, @Req() req: any) { const item = await this.prisma.project.create({ data: body }); await this.audit.record(req.admin.id, "PROJECT_CREATED", "Project", item.id); return item; }
  @Patch("projects/:id") async updateProject(@Param("id") id: string, @Body() body: Partial<ProjectDto>, @Req() req: any) { const item = await this.prisma.project.update({ where: { id }, data: body }); await this.audit.record(req.admin.id, "PROJECT_UPDATED", "Project", id, body); return item; }
  @Get("units") units(@Query("projectId") projectId?: string) { return this.prisma.unit.findMany({ where: projectId ? { projectId } : {}, include: { project: true, developer: true }, orderBy: { updatedAt: "desc" }, take: 250 }); }
  @Post("media") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  async media(@UploadedFile() file: Express.Multer.File, @Body() body: MediaDto, @Req() req: any) { if (!file || !file.mimetype.startsWith("image/")) throw new BadRequestException("A valid image is required"); if (!body.projectId && !body.unitId) throw new BadRequestException("projectId or unitId is required"); const stored = await this.storage.put(file.buffer, file.originalname, file.mimetype, body.unitId ? "units" : "projects"); const item = await this.prisma.media.create({ data: { type: body.type, url: stored.url, altText: body.altText, projectId: body.projectId, unitId: body.unitId } }); await this.audit.record(req.admin.id, "MEDIA_UPLOADED", "Media", item.id); return item; }
  @Post("documents") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  async document(@UploadedFile() file: Express.Multer.File, @Body() body: DocumentDto, @Req() req: any) { if (!file || !["application/pdf", "text/plain"].includes(file.mimetype)) throw new BadRequestException("A PDF or text document is required"); const stored = await this.storage.put(file.buffer, file.originalname, file.mimetype, "documents"); const item = await this.prisma.document.create({ data: { type: body.type, name: file.originalname, url: stored.url, mimeType: file.mimetype, projectId: body.projectId } }); await this.audit.record(req.admin.id, "DOCUMENT_UPLOADED", "Document", item.id); return item; }
}
