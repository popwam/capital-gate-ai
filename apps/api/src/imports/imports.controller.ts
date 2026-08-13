import { BadRequestException, Body, Controller, Get, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { IsNotEmpty, IsString } from "class-validator";
import { extname } from "node:path";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { AuditService } from "../audit.service";
import { ImporterService } from "./importer.service";

class ResolutionDto { @IsString() @IsNotEmpty() field!: string; value!: unknown; }
@UseGuards(AdminAuthGuard)
@Controller("admin/imports")
export class ImportsController {
  constructor(private readonly imports: ImporterService, private readonly audit: AuditService) {}
  @Get() list() { return this.imports.list(); }
  @Get(":id") get(@Param("id") id: string) { return this.imports.get(id); }
  @Post("upload") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string,string>, @Req() req: any) { if (!file) throw new BadRequestException("File is required"); const ext = extname(file.originalname).toLowerCase(); if (![".xlsx", ".xls", ".csv"].includes(ext)) throw new BadRequestException("Only .xlsx, .xls and .csv files are accepted"); const zip = file.buffer.subarray(0,2).toString("hex")==="504b"; const ole = file.buffer.subarray(0,8).toString("hex")==="d0cf11e0a1b11ae1"; const hasNulls = file.buffer.subarray(0,4096).includes(0); if ((ext===".xlsx"&&!zip)||(ext===".xls"&&!ole)||(ext===".csv"&&hasNulls)) throw new BadRequestException("The file content does not match its extension"); const item = await this.imports.analyze(file, body); await this.audit.record(req.admin.id, "IMPORT_UPLOADED", "DataImport", item.id, { fileName: file.originalname }); return item; }
  @Post(":id/resolve") resolve(@Param("id") id: string, @Body() body: ResolutionDto) { return this.imports.resolve(id, body.field, body.value); }
  @Post(":id/preview") preview(@Param("id") id: string) { return this.imports.preview(id); }
  @Post(":id/confirm") async confirm(@Param("id") id: string, @Req() req: any) { const result = await this.imports.confirm(id); await this.audit.record(req.admin.id, "IMPORT_CONFIRMED", "DataImport", id, result.result); return result; }
}
