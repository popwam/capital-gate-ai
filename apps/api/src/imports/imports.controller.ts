import { Body, Controller, Delete, Get, HttpStatus, Logger, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Allow, IsIn, IsNotEmpty, IsString } from "class-validator";
import { extname } from "node:path";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { AuditService } from "../audit.service";
import { ImporterService } from "./importer.service";
import { ImportHttpException, importErrorDetails } from "./import-errors";

class ResolutionDto { @IsString() @IsNotEmpty() field!: string; @Allow() value!: unknown; }
class SheetUpdateDto { @Allow() action?: unknown; @Allow() headerRow?: unknown; @Allow() projectId?: unknown; @Allow() phaseId?: unknown; @Allow() developerId?: unknown; @Allow() locationId?: unknown; @Allow() defaultCurrency?: unknown; @Allow() defaultUnitType?: unknown; @Allow() defaultIsResale?: unknown; }
class SheetMappingDto { @IsString() @IsNotEmpty() sourceColumn!: string; @IsString() @IsNotEmpty() canonicalField!: string; }
class PhaseValueMappingDto { @IsString() @IsNotEmpty() sourceValue!: string; @IsString() @IsNotEmpty() phaseId!: string; }
class CorrectionDto extends SheetMappingDto {}
class CorrectionDecisionDto { @Allow() decisions?: Record<string,string>; }
class RemoveBatchDto { @IsIn(["DELETE_UNFINISHED", "DELETE_SOURCE_RECORD", "DELETE_EXCLUSIVE_RECORDS", "ROLLBACK_SAFE"]) mode!: "DELETE_UNFINISHED" | "DELETE_SOURCE_RECORD" | "DELETE_EXCLUSIVE_RECORDS" | "ROLLBACK_SAFE"; }
@UseGuards(AdminAuthGuard)
@Controller("admin/imports")
export class ImportsController {
  private readonly logger = new Logger(ImportsController.name);
  constructor(private readonly imports: ImporterService, private readonly audit: AuditService) {}
  @Get() list(@Query("page") page?: string, @Query("pageSize") pageSize?: string) { return this.imports.list(Number(page) || 1, Number(pageSize) || 50); }
  @Get("options/selectors") options(@Query("type") type: string, @Query("search") search?: string, @Query("page") page?: string, @Query("pageSize") pageSize?: string) { return this.imports.options(type, search || "", Number(page) || 1, Number(pageSize) || 20); }
  @Get(":id") get(@Param("id") id: string) { return this.imports.get(id); }
  @Post("upload") @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  async upload(@UploadedFile() file: Express.Multer.File, @Body() body: Record<string,string>, @Req() req: any) {
    if (!file) throw new ImportHttpException(HttpStatus.BAD_REQUEST, "IMPORT_FILE_REQUIRED", "Choose an inventory file to upload.", "multipart");
    const ext = extname(file.originalname).toLowerCase();
    if (![".xlsx", ".xls", ".csv"].includes(ext)) throw new ImportHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "IMPORT_UNSUPPORTED_FILE_TYPE", "Only .xlsx, .xls and UTF-8 .csv files are supported.", "validation");
    const zip = file.buffer.subarray(0,2).toString("hex")==="504b";
    const ole = file.buffer.subarray(0,8).toString("hex")==="d0cf11e0a1b11ae1";
    const hasNulls = file.buffer.subarray(0,4096).includes(0);
    if ((ext===".xlsx"&&!zip)||(ext===".xls"&&!ole)||(ext===".csv"&&hasNulls)) throw new ImportHttpException(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "IMPORT_SIGNATURE_MISMATCH", "The file content does not match its extension.", "validation");
    try {
      const item = await this.imports.analyze(file, body, { requestId: req.requestId, adminUserId: req.admin.id });
      try { await this.audit.record(req.admin.id, "IMPORT_UPLOADED", "DataImport", item.id, { fileName: file.originalname, size: file.size, mime: file.mimetype, requestId: req.requestId }); } catch { this.logger.error(`ImportAuditFailure requestId=${req.requestId ?? "unknown"} adminUserId=${req.admin.id} importId=${item.id} action=IMPORT_UPLOADED`); }
      return item;
    } catch (error) {
      const details = importErrorDetails(error);
      try { await this.audit.record(req.admin.id, "IMPORT_UPLOAD_FAILED", "DataImport", typeof details.importId === "string" ? details.importId : undefined, { fileName: file.originalname, size: file.size, mime: file.mimetype, requestId: req.requestId, code: details.code ?? "IMPORT_UPLOAD_FAILED", stage: details.stage ?? "unknown" }); } catch { this.logger.error(`ImportAuditFailure requestId=${req.requestId ?? "unknown"} adminUserId=${req.admin.id} importId=${details.importId ?? "none"} action=IMPORT_UPLOAD_FAILED`); }
      throw error;
    }
  }
  @Post(":id/resolve") resolve(@Param("id") id: string, @Body() body: ResolutionDto) { return this.imports.resolve(id, body.field, body.value); }
  @Patch(":id/sheets") updateSelectedSheets(@Param("id") id:string,@Body() body:SheetUpdateDto){return this.imports.updateSelectedSheets(id,body as Record<string,unknown>);}
  @Patch(":id/sheets/all-inventory") allSheetsInventory(@Param("id") id:string){return this.imports.markAllSheetsAsInventory(id);}
  @Patch(":id/sheets/:sheetId") updateSheet(@Param("id") id: string, @Param("sheetId") sheetId: string, @Body() body: SheetUpdateDto) { return this.imports.updateImportSheet(id, sheetId, body as Record<string, unknown>); }
  @Patch(":id/sheets/:sheetId/mapping") updateSheetMapping(@Param("id") id: string, @Param("sheetId") sheetId: string, @Body() body: SheetMappingDto) { return this.imports.updateImportSheetMapping(id, sheetId, body.sourceColumn, body.canonicalField); }
  @Get(":id/sheets/:sheetId/phase-values") phaseValues(@Param("id") id: string, @Param("sheetId") sheetId: string) { return this.imports.getPhaseValues(id, sheetId); }
  @Patch(":id/sheets/:sheetId/phase-values") mapPhaseValue(@Param("id") id: string, @Param("sheetId") sheetId: string, @Body() body: PhaseValueMappingDto) { return this.imports.mapPhaseValue(id, sheetId, body.sourceValue, body.phaseId); }
  @Post(":id/sheets/:sheetId/corrections") async createCorrection(@Param("id") id:string,@Param("sheetId") sheetId:string,@Body() body:CorrectionDto,@Req() req:any){const result=await this.imports.createCorrection(id,sheetId,body.sourceColumn,body.canonicalField,req.admin.id);await this.audit.record(req.admin.id,"IMPORT_CORRECTION_CREATED","DataImport",id,{correctionId:result.id,sheetId,sourceColumn:body.sourceColumn,canonicalField:body.canonicalField});return result;}
  @Post(":id/corrections/:correctionId/preview") previewCorrection(@Param("id") id:string,@Param("correctionId") correctionId:string){return this.imports.previewCorrection(id,correctionId);}
  @Post(":id/corrections/:correctionId/confirm") async confirmCorrection(@Param("id") id:string,@Param("correctionId") correctionId:string,@Body() body:CorrectionDecisionDto,@Req() req:any){const result=await this.imports.confirmCorrection(id,correctionId,body.decisions);await this.audit.record(req.admin.id,"IMPORT_CORRECTION_CONFIRMED","DataImport",id,{correctionId,...result});return result;}
  @Post(":id/preview") preview(@Param("id") id: string) { return this.imports.preview(id); }
  @Post(":id/confirm")
  async confirm(@Param("id") id: string, @Req() req: any) {
    try {
      const result = await this.imports.confirm(id);
      try {
        await this.audit.record(req.admin.id, "IMPORT_CONFIRMED", "DataImport", id, result.result);
      } catch (auditError) {
        this.logger.error(`ImportAuditFailure requestId=${req.requestId ?? "unknown"} adminUserId=${req.admin.id} importId=${id} action=IMPORT_CONFIRMED error=${auditError instanceof Error ? auditError.message : String(auditError)}`);
      }
      return result;
    } catch (error) {
      const details = importErrorDetails(error);
      this.logger.error(`ImportConfirmFailure requestId=${req.requestId ?? "unknown"} adminUserId=${req.admin.id} importId=${id} code=${details.code ?? (error as any)?.code ?? "UNKNOWN"} stage=${details.stage ?? "unknown"} error=${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  @Delete(":id") async remove(@Param("id") id: string, @Body() body: RemoveBatchDto, @Req() req: any) { const result = await this.imports.removeBatch(id, body.mode); await this.audit.record(req.admin.id, "IMPORT_BATCH_REMOVED", "DataImport", id, { mode: body.mode, affected: result.affected, conflicts: result.conflicts, sourceObjectDeleted: result.sourceObjectDeleted, sourceObjectRetained: result.sourceObjectRetained, storageCleanupFailed: result.storageCleanupFailed }); return result; }
}
