import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApprovalStatus } from "@prisma/client";
import { IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { AuditService } from "../audit.service";
import { KnowledgeService } from "./knowledge.service";

class PasteDto { @IsString() @MinLength(20) text!: string; }
class ItemDto { @IsString() @MinLength(1) content!: string; @IsOptional() @IsEnum(ApprovalStatus) approvalStatus?: ApprovalStatus; }
@UseGuards(AdminAuthGuard)
@Controller("admin/projects/:projectId/knowledge")
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService, private readonly audit: AuditService) {}
  @Get() list(@Param("projectId") id: string) { return this.knowledge.list(id); }
  @Get("items") items(@Param("projectId") id: string) { return this.knowledge.items(id); }
  @Post("paste") async paste(@Param("projectId") projectId: string, @Body() body: PasteDto, @Req() req: any) { const item = await this.knowledge.paste(projectId, body.text); await this.audit.record(req.admin.id, "KNOWLEDGE_PASTED", "ProjectKnowledge", item.id); return item; }
  @Post("upload") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } })) async upload(@Param("projectId") projectId: string, @UploadedFile() file: Express.Multer.File, @Req() req: any) { if (!file) throw new BadRequestException("File is required"); const result = await this.knowledge.upload(projectId, file); await this.audit.record(req.admin.id, "KNOWLEDGE_UPLOADED", "ProjectKnowledge", result.knowledge.id); return result; }
  @Patch("items/:itemId") async update(@Param("itemId") id: string, @Body() body: ItemDto, @Req() req: any) { const item = await this.knowledge.updateItem(id, body.content, body.approvalStatus, req.admin.id); await this.audit.record(req.admin.id, "KNOWLEDGE_ITEM_UPDATED", "ProjectKnowledgeItem", id, { approvalStatus: body.approvalStatus }); return item; }
  @Post(":knowledgeId/approve") async approve(@Param("knowledgeId") id: string, @Req() req: any) { const item = await this.knowledge.approve(id, req.admin.id); await this.audit.record(req.admin.id, "KNOWLEDGE_APPROVED", "ProjectKnowledge", id); return item; }
}
