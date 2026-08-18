import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  ImportStatus,
  ImportUnitOperation,
  IssueSeverity,
  Prisma,
  UnitStatus,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import * as XLSX from "xlsx";
import { PrismaService } from "../database/prisma.service";
import {
  StorageProviderError,
  StorageService,
} from "../storage/storage.service";
import { AIProvider } from "../providers/ai-provider";
import { readImportWorkbook } from "./workbook-reader";
import { ImportHttpException, importErrorDetails } from "./import-errors";
import { rollbackConflict } from "./rollback-safety";
import { ApplicationCache } from "../cache/application-cache";
import { analyzeWorkbook, detectSemanticColumn, detectTableAt, DetectedTable, rawSheetMatrix, recordsForTable, WorkbookAnalysis } from "./workbook-analysis";
import {
  AVAILABILITY_TYPES,
  CANONICAL_FIELDS,
  CANONICAL_VALUES,
  CANONICAL_FIELD_MAP,
  METADATA_CANONICAL_VALUES,
  isCustomMetadataField,
  customMetadataLabel,
  FINISHING_TYPES,
  parseImportDate,
  parseDeliveryDurationYears,
  refineCanonicalFieldBySamples,
  parsePaymentPlanComponentHeader,
  SUPPORTED_CURRENCIES,
  UNIT_TYPES,
  normalizeFinishing,
  normalizeUnitType,
  PaymentPlanValueType,
} from "./import-contract";

const IMPORT_PREVIEW_ENGINE_VERSION = 3;
const CANONICAL: string[] = [...CANONICAL_VALUES];
const INVENTORY_CANONICAL = CANONICAL.filter((field) => !["downPayment", "installmentYears", "installmentAmount"].includes(field));
const METADATA_CANONICAL = new Set<string>(METADATA_CANONICAL_VALUES);
const supportedMappingTarget = (field: string) => INVENTORY_CANONICAL.includes(field) || isCustomMetadataField(field);
const CRITICAL_MAPPINGS = new Set([
  "externalUnitId", "price", "currency", "builtUpArea", "landArea", "gardenArea",
  "unitType", "bedrooms", "bathrooms", "deliveryDate", "status", "finishingType",
  "downPayment", "installmentYears", "installmentAmount",
]);
const KNOWN: Record<string, string> = {
  "unit no": "externalUnitId",
  "properties unit no.": "externalUnitId",
  "unit number": "externalUnitId",
  "unit code": "externalUnitId",
  "unit id": "externalUnitId",
  "property id": "externalUnitId",
  code: "externalUnitId",
  "كود الوحدة": "externalUnitId",
  "رقم الوحدة": "externalUnitId",
  type: "unitType",
  "unit type": "unitType",
  "property type": "unitType",
  subtype: "unitSubType",
  bedrooms: "bedrooms",
  beds: "bedrooms",
  br: "bedrooms",
  bathrooms: "bathrooms",
  baths: "bathrooms",
  "نوع الوحدة": "unitType",
  "غرف النوم": "bedrooms",
  غرف: "bedrooms",
  الحمامات: "bathrooms",
  bua: "builtUpArea",
  "built up area": "builtUpArea",
  "properties total gross area": "builtUpArea",
  "unit area": "builtUpArea",
  area: "builtUpArea",
  "land area": "landArea",
  garden: "gardenArea",
  roof: "roofArea",
  terrace: "terraceArea",
  المساحة: "builtUpArea",
  "المساحة المبنية": "builtUpArea",
  "مساحة الأرض": "landArea",
  حديقة: "gardenArea",
  روف: "roofArea",
  price: "price",
  "standard price": "price",
  "properties standard unit price": "price",
  "total price": "price",
  currency: "currency",
  status: "status",
  availability: "status",
  delivery: "deliveryDate",
  "delivery date": "deliveryDate",
  "properties delivery date": "deliveryDate",
  finishing: "finishingType",
  "properties finishing": "finishingType",
  السعر: "price",
  "السعر الإجمالي": "price",
  العملة: "currency",
  الحالة: "status",
  الإتاحة: "status",
  الاستلام: "deliveryDate",
  التشطيب: "finishingType",
  years: "installmentYears",
  "installment years": "installmentYears",
  installment: "installmentAmount",
  "club fees": "clubFees",
  discount: "discount",
  offer: "offerText",
  phase: "phase",
  cluster: "cluster",
  building: "building",
  floor: "floor",
  "سنوات التقسيط": "installmentYears",
  القسط: "installmentAmount",
  الخصم: "discount",
  العرض: "offerText",
  المرحلة: "phase",
  المبنى: "building",
  الدور: "floor",
};
type Analysis = {
  sheetName: string;
  sheets: string[];
  workbookAnalysis: WorkbookAnalysis;
  selectedTable?: DetectedTable;
  headers: string[];
  rows: Record<string, unknown>[];
  mappings: Record<string, string>;
  paymentPlanMappings: Record<string, { durationMonths?: number; valueType: "TOTAL_PRICE" | "INSTALLMENT_AMOUNT" | "DOWN_PAYMENT_AMOUNT" | "DOWN_PAYMENT_PERCENT" | "MAINTENANCE_AMOUNT" | "MAINTENANCE_PERCENT"; currency?: string; sourceDurationText: string; approved: boolean }>;
  mappingSources: Record<string, string>;
  mappingConfidence?: Record<string, number>;
  valueMappings: Record<string, Record<string, string>>;
  rowPolicies: Record<string, string>;
  unknownColumns: string[];
  metadataColumns?: string[];
  ignoredColumns?: string[];
  aiSuggestions: unknown[];
  aiMapping: {
    status: "NOT_NEEDED" | "COMPLETED" | "UNAVAILABLE";
    code?: string;
  };
  defaultValues: Record<string, unknown>;
  metadata: Record<string, string>;
  projectCandidates?: Array<{ id: string; name: string; developerName: string; locationName?: string; confidence: number }>;
  extractedWorkbookMetadata?: Record<string, string>;
  fileKey?: string;
};
type ImportContext = { requestId?: string; adminUserId?: string };
type ImportWorkflowStage =
  | "UPLOAD"
  | "ANALYZE"
  | "RESOLVE"
  | "PREVIEW"
  | "IMPORT"
  | "COMPLETE"
  | "FAILED";
type ImportReadiness = {
  stage: ImportWorkflowStage;
  selectedSheetCount: number;
  ignoredSheetCount: number;
  selectedSheets: string[];
  ignoredSheets: string[];
  activeTableCount: number;
  activeIssueCount: number;
  unresolvedBlockingCount: number;
  unresolvedWarningCount: number;
  missingCriticalMappings: string[];
  missingContext: string[];
  canPreview: boolean;
  canConfirm: boolean;
  previewExists: boolean;
  previewValid: boolean;
  previewRequired: boolean;
  legacyStateDetected: boolean;
  blockingReasons: string[];
  status: ImportStatus;
  nextRequiredAction: "RESOLVE_ISSUES" | "GENERATE_PREVIEW" | "CONFIRM_IMPORT" | "NONE";
};

@Injectable()
export class ImporterService {
  private readonly logger = new Logger(ImporterService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject("AI_PROVIDER") private readonly ai: AIProvider,
    @Optional() private readonly cache?: ApplicationCache,
  ) {}
  private normalize(v: string) {
    return v.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }
  private normalizePhaseValue(v: string) {
    const westernDigits = v.replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
    return westernDigits
      .toLowerCase()
      .trim()
      .replace(/(?:\bphase\b|المرحلة|مرحلة)/giu, "")
      .replace(/^p(?=\d)/iu, "")
      .replace(/[^a-z0-9\u0600-\u06ff]+/giu, "")
      .trim();
  }
  private json<T>(value: T): any {
    return JSON.parse(JSON.stringify(value));
  }

  private deterministicSheetMappings(table: DetectedTable, remembered: Array<{ normalizedColumn: string; canonicalField: string }> = []) {
    const mappings: Record<string, string> = {};
    const sources: Record<string, string> = {};
    for (const column of table.columns) {
      const detected = column.semanticField
        ? { field: column.semanticField, confidence: column.confidence }
        : detectSemanticColumn(column.originalHeader);
      const prior = remembered.find((mapping) => mapping.normalizedColumn === this.normalize(column.originalHeader));
      const detectedCanonical = KNOWN[this.normalize(column.originalHeader)] ?? detected?.field;
      const canonical = prior?.canonicalField ?? (detectedCanonical ? refineCanonicalFieldBySamples(detectedCanonical, column.samples ?? []) : undefined);
      if (!canonical) continue;
      if (["downPayment", "installmentYears", "installmentAmount"].includes(canonical)) {
        mappings[column.key] = "__METADATA__";
        sources[column.key] = "PAYMENT_PLAN_MANUAL_ONLY";
        continue;
      }
      if (INVENTORY_CANONICAL.includes(canonical)) {
        mappings[column.key] = canonical;
        sources[column.key] = prior ? "ADMIN_APPROVED_MEMORY" : canonical !== detectedCanonical ? "KNOWN_RULE_VALUE_SHAPE" : "KNOWN_RULE";
      }
    }
    return { mappings, sources };
  }

  private sheetIssueField(sheetId: string, field: string) {
    return `sheet:${sheetId}:${field}`;
  }

  private async rebuildSheetIssues(sheetId: string) {
    const sheet = await this.prisma.importSheet.findUniqueOrThrow({ where: { id: sheetId } });
    const prefix = `sheet:${sheet.id}:`;
    await this.prisma.importIssue.deleteMany({
      where: { importId: sheet.importId, field: { startsWith: prefix } },
    });
    if (sheet.action !== "IMPORT") return;
    const mappings = (sheet.mappings ?? {}) as Record<string, string>;
    const columns = (sheet.columns ?? []) as Array<{ key: string; originalHeader: string; samples?: unknown[] }>;
    const issues: Prisma.ImportIssueCreateManyInput[] = [];
    const required = (field: string, message: string, inputType: string, options?: unknown) =>
      issues.push({ importId: sheet.importId, severity: IssueSeverity.BLOCKING, field: this.sheetIssueField(sheet.id, field), message, inputType, options: options == null ? undefined : this.json(options), required: true });
    if (!sheet.headerRow || !columns.length) required("header", "اختر صف العناوين الصحيح لهذا الجدول.", "WORKBOOK_TABLE_SELECT");
    if (!sheet.projectId) required("projectId", "اختر المشروع الخاص بهذا الجدول.", "PROJECT_SELECT", { allowCreate: true });
    if (!sheet.developerId) required("developerId", "اختر المطور الخاص بهذا الجدول.", "DEVELOPER_SELECT", { allowCreate: true });
    if (!sheet.locationId) required("locationId", "اختر موقع المشروع الخاص بهذا الجدول.", "LOCATION_SELECT", { allowCreate: true });
    const phaseColumn = Object.entries(mappings).find(([, target]) => target === "phase")?.[0];
    if (!phaseColumn) {
      if (!sheet.phaseId) required("phaseId", "اختر مرحلة واحدة لهذا الجدول، أو اربط عمود المراحل من الملف بحقل «المرحلة».", "PHASE_SELECT", { allowCreate: true });
    } else if (sheet.projectId && sheet.headerRow && columns.length) {
      const phaseReview = await this.phaseValuesForSheetRecord(sheet).catch(() => null);
      if (phaseReview && phaseReview.values.length === 0) {
        required("phaseValues", `عمود المراحل «${phaseReview.sourceHeader || phaseColumn}» لا يحتوي على قيم.`, "PHASE_VALUE_MAPPING", phaseReview);
      } else if (phaseReview?.unmatchedCount) {
        required("phaseValues", `اربط ${phaseReview.unmatchedCount} ${phaseReview.unmatchedCount === 1 ? "قيمة مرحلة" : "قيم مراحل"} بالمراحل المسجلة. القرار يتم مرة واحدة لكل قيمة وليس لكل صف.`, "PHASE_VALUE_MAPPING", phaseReview);
      }
    }
    if (!sheet.defaultCurrency && !Object.values(mappings).includes("currency")) required("currency", "حدد عملة أسعار هذا الجدول.", "CURRENCY_SELECT", SUPPORTED_CURRENCIES);
    if (!Object.values(mappings).includes("externalUnitId")) required("mapping:externalUnitId", "اختر عمود كود الوحدة.", "CANONICAL_FIELD_SELECT", { sourceHeaders: columns.map((column) => column.key), detectedColumns: columns });
    for (const column of columns) {
      if (mappings[column.key]) continue;
      required(`column:${column.key}`, `راجع معنى العمود «${column.originalHeader}».`, "CANONICAL_FIELD_SELECT", { sourceColumn: column.key, fields: CANONICAL_FIELDS.filter((field) => INVENTORY_CANONICAL.includes(field.value)), samples: column.samples ?? [], actions: ["METADATA", "IGNORE"] });
    }
    if (issues.length) await this.prisma.importIssue.createMany({ data: issues });
  }

  private async initializeImportSheets(importId: string, workbookAnalysis: WorkbookAnalysis, metadata: Record<string, string>, legacyMappings?: Record<string, string>) {
    const developerSlug = metadata.developerSlug || "__global__";
    const remembered = await this.prisma.importMapping.findMany({ where: { approved: true, developerSlug: { in: [developerSlug, "__global__"] } } });
    for (const sheet of workbookAnalysis.sheets) {
      const tables = sheet.candidateTables.length ? sheet.candidateTables : [undefined];
      for (const table of tables) {
        const deterministic = table ? this.deterministicSheetMappings(table, remembered) : { mappings: {}, sources: {} };
        if (table && legacyMappings) for (const column of table.columns) {
          const legacy = legacyMappings[column.key];
          if (legacy && INVENTORY_CANONICAL.includes(legacy)) {
            deterministic.mappings[column.key] = legacy;
            deterministic.sources[column.key] = "ADMIN_APPROVED";
          }
        }
        const isLegacySelected = !legacyMappings || (sheet.name === workbookAnalysis.selectedSheet && table?.id === workbookAnalysis.selectedTableId);
        const action = sheet.classification === "INVENTORY" && table && isLegacySelected ? "IMPORT" : "IGNORE";
        const created = await this.prisma.importSheet.create({
          data: {
            importId,
            sheetName: sheet.name,
            tableId: table?.id,
            classification: sheet.classification,
            confidence: table?.confidence ?? sheet.confidence,
            action,
            headerRow: table?.headerRow,
            startRow: table?.startRow,
            endRow: table?.endRow,
            rowsDetected: table?.dataRowCount ?? 0,
            projectId: metadata.projectId || undefined,
            developerId: metadata.developerId || undefined,
            locationId: metadata.locationId || undefined,
            defaultCurrency: metadata.currency || undefined,
            defaultUnitType: metadata.unitType || undefined,
            columns: table ? this.json(table.columns) : undefined,
            mappings: this.json(deterministic.mappings),
            mappingSources: this.json(deterministic.sources),
            sourcePreview: table ? this.json(table.previewRows) : undefined,
          },
        });
        await this.rebuildSheetIssues(created.id);
      }
    }
    await this.prisma.dataImport.update({
      where: { id: importId },
      data: { status: ImportStatus.NEEDS_INPUT, preview: Prisma.DbNull, rowsDetected: workbookAnalysis.sheets.filter((sheet) => sheet.classification === "INVENTORY").reduce((total, sheet) => total + sheet.candidateTables.reduce((sum, table) => sum + table.dataRowCount, 0), 0) },
    });
    return this.refreshImportReadiness(importId);
  }

  private getImportReadiness(item: {
    status: ImportStatus;
    issues: Array<{ field?: string | null; message?: string; severity: IssueSeverity; resolvedAt: Date | null; required?: boolean }>;
    analysis: unknown;
    preview: unknown;
    developerId: string | null;
    projectId: string | null;
    sheets?: Array<{
      id: string;
      sheetName: string;
      action: string;
      headerRow: number | null;
      projectId: string | null;
      developerId: string | null;
      locationId: string | null;
      phaseId: string | null;
      defaultCurrency: string | null;
      mappings: unknown;
      mappingVersion: number;
      previewMappingVersion: number | null;
    }>;
  }): ImportReadiness {
    const analysis = (item.analysis ?? {}) as Partial<Analysis>;
    const selectedSheets = item.sheets?.filter((sheet) => sheet.action === "IMPORT") ?? [];
    const selectedIds = new Set(selectedSheets.map((sheet: any) => sheet.id));
    const activeIssues = item.sheets?.length
      ? item.issues.filter((issue) => {
          const match = String(issue.field ?? "").match(/^sheet:([^:]+):/);
          return Boolean(match && selectedIds.has(match[1]));
        })
      : item.issues;
    const unresolved = activeIssues.filter((issue) => !issue.resolvedAt);
    const unresolvedBlockingCount = unresolved.filter(
      (issue) => issue.severity === IssueSeverity.BLOCKING || issue.required === true,
    ).length;
    const unresolvedWarningCount = unresolved.filter(
      (issue) =>
        issue.severity !== IssueSeverity.BLOCKING &&
        issue.severity !== IssueSeverity.INFO &&
        issue.required !== true,
    ).length;
    const mappings = analysis.mappings ?? {};
    const metadata = analysis.metadata ?? {};
    const hasIdentity = Object.values(mappings).includes("externalUnitId");
    const hasCurrency =
      Object.values(mappings).includes("currency") ||
      SUPPORTED_CURRENCIES.includes(
        String(analysis.defaultValues?.currency ?? "").toUpperCase() as any,
      );
    const contextValid = Boolean(
      analysis.selectedTable &&
        hasIdentity &&
        hasCurrency &&
        (item.projectId || metadata.projectId) &&
        (item.developerId || metadata.developerId) &&
        metadata.locationId,
    );
    const missingCriticalMappings: string[] = [];
    const missingContext: string[] = [];
    for (const sheet of selectedSheets as any[]) {
      const values = Object.values((sheet.mappings ?? {}) as Record<string, string>);
      if (!values.includes("externalUnitId")) missingCriticalMappings.push(`${sheet.sheetName}:externalUnitId`);
      if (!sheet.headerRow) missingContext.push(`${sheet.sheetName}:headerRow`);
      if (!sheet.projectId) missingContext.push(`${sheet.sheetName}:projectId`);
      if (!sheet.developerId) missingContext.push(`${sheet.sheetName}:developerId`);
      if (!sheet.locationId) missingContext.push(`${sheet.sheetName}:locationId`);
      if (!sheet.phaseId && !values.includes("phase")) missingContext.push(`${sheet.sheetName}:phase`);
      if (!sheet.defaultCurrency && !values.includes("currency")) missingContext.push(`${sheet.sheetName}:currency`);
    }
    if (item.sheets?.length && selectedSheets.length === 0) missingContext.push("workbook:selectedSheet");
    if (!item.sheets?.length) {
      if (!analysis.selectedTable) missingContext.push("workbook:headerRow");
      if (!hasIdentity) missingCriticalMappings.push("workbook:externalUnitId");
      if (!hasCurrency) missingContext.push("workbook:currency");
      if (!(item.projectId || metadata.projectId)) missingContext.push("workbook:projectId");
      if (!(item.developerId || metadata.developerId)) missingContext.push("workbook:developerId");
      if (!metadata.locationId) missingContext.push("workbook:locationId");
    }
    const sheetsValid = selectedSheets.length > 0 && selectedSheets.every((sheet) => {
      const sheetMappings = (sheet.mappings ?? {}) as Record<string, string>;
      return Boolean(
        sheet.headerRow &&
        sheet.projectId &&
        sheet.developerId &&
        sheet.locationId &&
        (sheet.phaseId || Object.values(sheetMappings).includes("phase")) &&
        (sheet.defaultCurrency || Object.values(sheetMappings).includes("currency")) &&
        Object.values(sheetMappings).includes("externalUnitId"),
      );
    });
    const canPreview = unresolvedBlockingCount === 0 && missingCriticalMappings.length === 0 && missingContext.length === 0 && (item.sheets?.length ? sheetsValid : contextValid);
    const preview = item.preview as Record<string, unknown> | null;
    const previewExists = Boolean(preview);
    const previewValid = previewExists && Number(preview?.engineVersion ?? 0) === IMPORT_PREVIEW_ENGINE_VERSION && (item.sheets?.length
      ? selectedSheets.every((sheet) => sheet.previewMappingVersion === sheet.mappingVersion)
      : true);
    const canConfirm = canPreview && previewValid && preview?.canConfirm === true;
    const terminal = item.status === ImportStatus.COMPLETED;
    const failed =
      item.status === ImportStatus.FAILED ||
      item.status === ImportStatus.CANCELLED ||
      item.status === ImportStatus.ROLLED_BACK;
    const stage: ImportWorkflowStage = terminal
      ? "COMPLETE"
      : failed
        ? "FAILED"
        : item.status === ImportStatus.UPLOADED || item.status === ImportStatus.ANALYZING
          ? "ANALYZE"
          : !canPreview
            ? "RESOLVE"
            : !previewExists || !canConfirm
              ? "PREVIEW"
              : "IMPORT";
    const derivedStatus = terminal || failed ? item.status : canPreview ? ImportStatus.READY : ImportStatus.NEEDS_INPUT;
    const blockingReasons = [
      ...unresolved.filter((issue) => issue.severity === IssueSeverity.BLOCKING || issue.required === true).map((issue) => issue.message || issue.field || "Unresolved import requirement"),
      ...missingCriticalMappings.map((field) => `Missing critical mapping: ${field}`),
      ...missingContext.map((field) => `Missing context: ${field}`),
    ];
    return {
      stage,
      selectedSheetCount: selectedSheets.length,
      ignoredSheetCount: item.sheets?.filter((sheet) => sheet.action === "IGNORE").length ?? 0,
      selectedSheets: selectedSheets.map((sheet: any) => sheet.sheetName),
      ignoredSheets: item.sheets?.filter((sheet) => sheet.action === "IGNORE").map((sheet: any) => sheet.sheetName) ?? [],
      activeTableCount: selectedSheets.filter((sheet: any) => Boolean(sheet.headerRow)).length,
      activeIssueCount: activeIssues.length,
      unresolvedBlockingCount,
      unresolvedWarningCount,
      missingCriticalMappings,
      missingContext,
      canPreview,
      canConfirm,
      previewExists,
      previewValid,
      previewRequired: canPreview && !previewValid,
      legacyStateDetected: Boolean((analysis as any).legacyStateDetected),
      blockingReasons,
      status: derivedStatus,
      nextRequiredAction: terminal || failed
        ? "NONE"
        : !canPreview
          ? "RESOLVE_ISSUES"
          : !previewExists || !canConfirm
            ? "GENERATE_PREVIEW"
            : "CONFIRM_IMPORT",
    };
  }

  private withImportReadiness<T extends {
    status: ImportStatus;
    issues: Array<{ severity: IssueSeverity; resolvedAt: Date | null; required?: boolean }>;
    analysis: unknown;
    preview: unknown;
    developerId: string | null;
    projectId: string | null;
    sheets?: any[];
  }>(item: T): T & { workflow: ImportReadiness } {
    return { ...item, workflow: this.getImportReadiness(item) };
  }

  async analyze(
    file: Express.Multer.File,
    metadata: Record<string, string>,
    context: ImportContext = {},
  ) {
    const safeFileName = file.originalname
      .replace(/[\r\n]/g, " ")
      .slice(0, 180);
    const diagnostic = (
      stage: string,
      code: string,
      importId?: string,
      error?: unknown,
    ) => {
      const details = importErrorDetails(error);
      const upstreamStatus =
        error instanceof StorageProviderError
          ? error.upstreamStatus
          : details.upstreamStatus;
      this.logger.error(
        `ImportFailure requestId=${context.requestId ?? "unknown"} adminUserId=${context.adminUserId ?? "unknown"} importId=${importId ?? "none"} filename=${JSON.stringify(safeFileName)} size=${file.size} mime=${file.mimetype || "unknown"} stage=${stage} code=${code} upstreamStatus=${upstreamStatus ?? "none"}`,
      );
    };
    let workbook: XLSX.WorkBook;
    try {
      workbook = readImportWorkbook(file.buffer, file.originalname);
    } catch (error) {
      if (error instanceof ImportHttpException) throw error;
      diagnostic("parser", "IMPORT_PARSE_FAILED", undefined, error);
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_PARSE_FAILED",
        "The file could not be read as a valid workbook.",
        "parser",
      );
    }
    if (!workbook.SheetNames.length)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_NO_USABLE_SHEETS",
        "The workbook contains no usable sheets.",
        "parser",
      );
    const workbookAnalysis = analyzeWorkbook(workbook, file.originalname);
    const populatedCells = workbookAnalysis.sheets.reduce((total, sheet) => total + sheet.rawPreview.reduce((sum, row) => sum + row.cells.filter((cell) => cell != null && String(cell).trim() !== "").length, 0), 0);
    if (!populatedCells) throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_NO_USABLE_SHEETS", "The workbook contains no usable data rows.", "parser");
    if (process.env.NODE_ENV !== "production") this.logger.debug(`WorkbookAnalysis ${JSON.stringify({ requestId: context.requestId ?? "unknown", sheets: workbookAnalysis.sheets.map((sheet) => ({ name: sheet.name, classification: sheet.classification, confidence: sheet.confidence, regions: sheet.regions, headerCandidates: sheet.headerCandidates.map((candidate) => ({ row: candidate.row, confidence: candidate.confidence, rejected: candidate.rejected })), mappings: sheet.candidateTables[0]?.columns.map((column) => ({ header: column.originalHeader, semanticField: column.semanticField, confidence: column.confidence })) })), selectedSheet: workbookAnalysis.selectedSheet, warnings: workbookAnalysis.warnings })}`);
    const selectedSheet = workbookAnalysis.sheets.find((sheet) => sheet.name === workbookAnalysis.selectedSheet);
    const selectedTable = selectedSheet?.candidateTables.find((table) => table.id === workbookAnalysis.selectedTableId);
    const sheetName = selectedSheet?.name ?? workbook.SheetNames[0];
    const rows = selectedTable ? recordsForTable(workbook, selectedTable) : [];
    const totalRows = workbookAnalysis.sheets.reduce((total, sheet) => total + sheet.rowCount, 0);
    if (totalRows > 10_000)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_ROW_LIMIT_EXCEEDED",
        "Imports are limited to 10,000 rows per file.",
        "parser",
      );
    const headers = selectedTable?.columns.map((column) => column.key) ?? [];
    const mappings: Record<string, string> = {};
    const paymentPlanMappings: Analysis["paymentPlanMappings"] = {};
    const mappingSources: Record<string, string> = {};
    const mappingConfidence: Record<string, number> = {};
    if (metadata.parentImportId && !metadata.projectId) {
      const parent = await this.prisma.dataImport.findUnique({ where: { id: metadata.parentImportId }, select: { projectId: true, developerId: true, project: { select: { locationId: true, developer: { select: { slug: true } } } } } });
      if (parent) {
        metadata.projectId ||= parent.projectId ?? "";
        metadata.developerId ||= parent.developerId ?? "";
        metadata.locationId ||= parent.project?.locationId ?? "";
        metadata.developerSlug ||= parent.project?.developer.slug ?? "";
      }
    }
    if (metadata.projectId) {
      const selected = await this.prisma.project.findUnique({ where: { id: metadata.projectId }, select: { developerId: true, locationId: true, developer: { select: { slug: true } } } });
      if (selected) {
        metadata.developerId ||= selected.developerId;
        metadata.locationId ||= selected.locationId ?? "";
        metadata.developerSlug ||= selected.developer.slug;
      }
    }
    const developerSlug = metadata.developerSlug || "__global__";
    const remembered = await this.prisma.importMapping.findMany({
      where: {
        approved: true,
        developerSlug: { in: [developerSlug, "__global__"] },
      },
    });
    for (const header of headers) {
      const normalized = this.normalize(header);
      const prior = remembered.find((m) => m.normalizedColumn === normalized);
      const detected = selectedTable?.columns.find((column) => column.key === header);
      const semantic = detected?.semanticField ? { field: detected.semanticField, confidence: detected.confidence } : detectSemanticColumn(header);
      const field = prior?.canonicalField ?? KNOWN[normalized] ?? semantic?.field;
      if (field?.startsWith("paymentPlan:")) {
        const [, duration, valueType = "TOTAL_PRICE"] = field.split(":");
        paymentPlanMappings[header] = { durationMonths: Number(duration) || undefined, valueType: valueType as PaymentPlanValueType, sourceDurationText: header, approved: true };
      } else if (field) {
        mappings[header] = field;
        mappingSources[header] = prior ? "ADMIN_APPROVED_MEMORY" : "KNOWN_RULE";
        mappingConfidence[header] = prior ? Number(prior.confidence ?? 1) : semantic?.confidence ?? .8;
      } else {
        const detectedPlan = parsePaymentPlanComponentHeader(header);
        if (detectedPlan) paymentPlanMappings[header] = { ...detectedPlan, approved: false };
      }
    }
    const unknown = headers.filter((h) => !mappings[h] && !paymentPlanMappings[h]);
    const valueMappings: Record<string, Record<string, string>> = {};
    const priorValues = await this.prisma.importValueMapping.findMany({
      where: {
        developerSlug: { in: [developerSlug, "__global__"] },
        approved: true,
      },
    });
    for (const item of priorValues)
      (valueMappings[item.canonicalField] ??= {})[item.normalizedValue] =
        item.targetValue;
    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const analysis: Analysis = {
      sheetName,
      sheets: workbook.SheetNames,
      workbookAnalysis,
      selectedTable,
      headers,
      rows: this.json(rows),
      mappings,
      paymentPlanMappings,
      mappingSources,
      mappingConfidence,
      valueMappings,
      rowPolicies: {},
      unknownColumns: unknown,
      metadataColumns: [],
      ignoredColumns: [],
      aiSuggestions: [],
      aiMapping: { status: unknown.length ? "UNAVAILABLE" : "NOT_NEEDED" },
      defaultValues: {},
      metadata,
    };
    const extractedWorkbookMetadata: Record<string, string> = {};
    for (const sheet of workbookAnalysis.sheets.filter((entry) => ["SUMMARY", "PROJECT_INFO"].includes(entry.classification))) {
      for (const row of sheet.rawPreview) {
        const values = row.cells.filter((cell) => cell != null && String(cell).trim() !== "");
        if (values.length !== 2) continue;
        const label = this.normalize(String(values[0]));
        if (/^(?:project|project name|المشروع|اسم المشروع)$/iu.test(label)) extractedWorkbookMetadata.projectName = String(values[1]).trim();
        if (/^(?:developer|developer name|المطور|اسم المطور)$/iu.test(label)) extractedWorkbookMetadata.developerName = String(values[1]).trim();
        if (/^(?:location|area|الموقع|المنطقه|المنطقة)$/iu.test(label)) extractedWorkbookMetadata.locationName = String(values[1]).trim();
      }
    }
    analysis.extractedWorkbookMetadata = extractedWorkbookMetadata;
    const projectHint = extractedWorkbookMetadata.projectName || file.originalname.replace(/\.(?:xlsx|xls|csv)$/iu, "").replace(/[_-]+/g, " ").trim();
    if (!metadata.projectId && projectHint.length >= 3 && typeof (this.prisma.project as any).findMany === "function") {
      const hintTokens = this.normalize(projectHint).split(" ").filter((token) => token.length >= 2).slice(0, 5);
      const candidates = await this.prisma.project.findMany({ where: { OR: [{ name: { contains: projectHint, mode: "insensitive" } }, ...hintTokens.map((token) => ({ name: { contains: token, mode: "insensitive" as const } }))] }, take: 8, include: { developer: { select: { name: true } }, location: { select: { name: true } } } });
      analysis.projectCandidates = candidates.map((project) => { const normalizedName = this.normalize(project.name); const matches = hintTokens.filter((token) => normalizedName.includes(token)).length; return { id: project.id, name: project.name, developerName: project.developer.name, locationName: project.location?.name, confidence: hintTokens.length ? Math.round(matches / hintTokens.length * 100) : 0 }; }).sort((left, right) => right.confidence - left.confidence);
    }
    let dataImport;
    try {
      if (metadata.parentImportId) {
        const parent = await this.prisma.dataImport.findUnique({
          where: { id: metadata.parentImportId },
          select: { developerId: true, projectId: true, status: true, project: { select: { locationId: true } } },
        });
        if (!parent || parent.status !== ImportStatus.COMPLETED)
          throw new ImportHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "IMPORT_PARENT_INVALID",
            "Select a completed import batch to update.",
            "validation",
          );
        metadata.developerId ||= parent.developerId ?? "";
        metadata.projectId ||= parent.projectId ?? "";
        metadata.locationId ||= parent.project?.locationId ?? "";
      }
      if (metadata.projectId) {
        const selectedProject = await this.prisma.project.findUnique({
          where: { id: metadata.projectId },
          select: { developerId: true, locationId: true },
        });
        if (!selectedProject)
          throw new ImportHttpException(
            HttpStatus.UNPROCESSABLE_ENTITY,
            "IMPORT_PROJECT_INVALID",
            "اختر مشروعاً موجوداً.",
            "validation",
          );
        metadata.developerId ||= selectedProject.developerId;
        metadata.locationId ||= selectedProject.locationId ?? "";
      }
      dataImport = await this.prisma.dataImport.create({
        data: {
          name: metadata.batchName || file.originalname,
          fileName: file.originalname,
          fileHash,
          status: ImportStatus.ANALYZING,
          rowsDetected: rows.length,
          mappingConfig: this.json({ mappings, mappingSources }),
          analysis: this.json(analysis),
          developerId: metadata.developerId || undefined,
          projectId: metadata.projectId || undefined,
          uploadedByAdminId: context.adminUserId,
          parentImportId: metadata.parentImportId || undefined,
          missingUnitPolicy: metadata.missingUnitPolicy || "LEAVE_UNCHANGED",
        },
      });
    } catch (error) {
      diagnostic("database", "IMPORT_DATABASE_FAILED", undefined, error);
      throw new ImportHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "IMPORT_DATABASE_FAILED",
        "The import could not be recorded.",
        "database",
      );
    }
    try {
      let stored;
      try {
        stored = await this.storage.put(
          file.buffer,
          file.originalname,
          file.mimetype || "application/octet-stream",
          "imports",
        );
        analysis.fileKey = stored.key;
        await this.prisma.dataImport.update({
          where: { id: dataImport.id },
          data: { fileUrl: stored.url, analysis: this.json(analysis) },
        });
      } catch (error) {
        const storageCode =
          error instanceof StorageProviderError ? error.code : "UNKNOWN";
        const code =
          storageCode === "AUTH"
            ? "IMPORT_STORAGE_AUTH_FAILED"
            : storageCode === "BUCKET"
              ? "IMPORT_STORAGE_BUCKET_FAILED"
              : storageCode === "NETWORK"
                ? "IMPORT_STORAGE_NETWORK_FAILED"
                : "IMPORT_STORAGE_FAILED";
        diagnostic("storage", code, dataImport.id, error);
        await this.markFailed(dataImport.id, code, "storage");
        throw new ImportHttpException(
          HttpStatus.SERVICE_UNAVAILABLE,
          code,
          "Storage upload failed. Please retry or contact an administrator.",
          "storage",
          dataImport.id,
        );
      }

      return this.initializeImportSheets(dataImport.id, workbookAnalysis, metadata);
    } catch (error) {
      if (error instanceof ImportHttpException) throw error;
      diagnostic("database", "IMPORT_DATABASE_FAILED", dataImport.id, error);
      await this.markFailed(
        dataImport.id,
        "IMPORT_DATABASE_FAILED",
        "database",
      );
      throw new ImportHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "IMPORT_DATABASE_FAILED",
        "The workbook was stored, but its analysis could not be recorded.",
        "database",
        dataImport.id,
      );
    }
  }

  private async markFailed(importId: string, code: string, stage: string) {
    try {
      await this.prisma.dataImport.update({
        where: { id: importId },
        data: {
          status: ImportStatus.FAILED,
          warnings: this.json({
            code,
            stage,
            failedAt: new Date().toISOString(),
          }),
        },
      });
    } catch {
      /* preserve the original failure */
    }
  }

  private async createIssues(
    importId: string,
    analysis: Analysis,
    prisma: Prisma.TransactionClient = this.prisma,
    aiUnavailable = false,
  ) {
    const mapped = new Set(Object.values(analysis.mappings));
    const issues: Prisma.ImportIssueCreateManyInput[] = [];
    if (!analysis.selectedTable) {
      issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "workbook:selection", message: "لم نتمكن من تحديد جدول وحدات موثوق داخل الملف. اختر الصفحة وصف العناوين الصحيح لمتابعة الاستيراد.", inputType: "WORKBOOK_TABLE_SELECT", options: this.json({ code: "HEADER_NOT_FOUND", sheets: analysis.workbookAnalysis.sheets.map((sheet) => ({ name: sheet.name, classification: sheet.classification, confidence: sheet.confidence, rowCount: sheet.rowCount, candidateTables: sheet.candidateTables, headerCandidates: sheet.headerCandidates, rawPreview: sheet.rawPreview })) }), required: true });
      await prisma.importIssue.createMany({ data: issues });
      return;
    }
    if (analysis.selectedTable.confidence < 65) {
      issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "workbook:selection", message: "تم العثور على جدول محتمل، لكن دقة تحديد صف العناوين منخفضة. راجع الصفحة وصف العناوين قبل المتابعة.", inputType: "WORKBOOK_TABLE_SELECT", options: this.json({ code: "AMBIGUOUS_HEADER", selectedSheet: analysis.sheetName, selectedHeaderRow: analysis.selectedTable.headerRow, sheets: analysis.workbookAnalysis.sheets.map((sheet) => ({ name: sheet.name, classification: sheet.classification, confidence: sheet.confidence, rowCount: sheet.rowCount, candidateTables: sheet.candidateTables, headerCandidates: sheet.headerCandidates, rawPreview: sheet.rawPreview })) }), required: true });
      await prisma.importIssue.createMany({ data: issues });
      return;
    }
    if (!mapped.has("externalUnitId"))
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "mapping:externalUnitId",
        message: "لم أتمكن من تحديد كود الوحدة. اختر العمود الذي يميز كل وحدة.",
        inputType: "CANONICAL_FIELD_SELECT",
        options: this.json({ canonicalField: "externalUnitId", sourceHeaders: analysis.headers, detectedColumns: analysis.selectedTable?.columns }),
        required: true,
      });
    if (!mapped.has("currency"))
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "currency",
        message: "الأسعار الموجودة في الملف بأي عملة؟",
        inputType: "CURRENCY_SELECT",
        options: this.json(SUPPORTED_CURRENCIES),
        required: true,
      });
    if (!analysis.metadata.projectId)
      issues.unshift({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "projectId",
        message: "الملف ده تابع لأي مشروع؟",
        inputType: "PROJECT_SELECT",
        options: this.json({ allowCreate: true, potentialMatches: analysis.projectCandidates ?? [], extractedProjectName: analysis.extractedWorkbookMetadata?.projectName }),
        required: true,
      });
    if (!analysis.metadata.developerId)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "developerId",
        message: "المشروع تابع لأي مطور؟",
        inputType: "DEVELOPER_SELECT",
        options: this.json({ allowCreate: true }),
        required: true,
      });
    if (!analysis.metadata.locationId)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "locationId",
        message: "المشروع موجود في أي منطقة؟",
        inputType: "LOCATION_SELECT",
        options: this.json({ allowCreate: true }),
        required: true,
      });
    for (const [column, canonical] of Object.entries(analysis.mappings)) {
      const source = analysis.mappingSources[column];
      const confidence = analysis.mappingConfidence?.[column] ?? 0;
      if (!CRITICAL_MAPPINGS.has(canonical) || source === "ADMIN_APPROVED_MEMORY" || source === "ADMIN_APPROVED" || confidence >= .95) continue;
      const field = CANONICAL_FIELDS.find((option) => option.value === canonical);
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: `column:${column}`,
        message: `راجع معنى العمود «${column}». النظام يقترح «${field?.labelAr ?? canonical}» ويحتاج تأكيدك أول مرة.`,
        inputType: "CANONICAL_FIELD_SELECT",
        options: this.json({ sourceColumn: column, fields: CANONICAL_FIELDS, suggestedValue: canonical, mappingSource: source, mappingConfidence: confidence, samples: analysis.selectedTable?.columns.find((item) => item.key === column)?.samples ?? [], requiresConfirmation: true }),
        required: true,
      });
    }
    for (const [column, plan] of Object.entries(analysis.paymentPlanMappings))
      if (!plan.approved)
        issues.push({
          importId,
          severity: IssueSeverity.BLOCKING,
          field: `paymentPlan:${column}`,
          message: `راجع خطة السداد المستخرجة من العمود «${column}».`,
          inputType: "PAYMENT_PLAN_MAPPING",
          options: this.json({ sourceColumn: column, suggestedDurationMonths: plan.durationMonths, suggestedValueType: plan.valueType, currencies: SUPPORTED_CURRENCIES }),
          required: true,
        });
    for (const column of analysis.unknownColumns)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: `column:${column}`,
        message: `العمود «${column}» غير معروف. اختر معناه أو احتفظ به كمعلومة إضافية أو تجاهله.`,
        inputType: "CANONICAL_FIELD_SELECT",
        options: this.json({ sourceColumn: column, fields: CANONICAL_FIELDS, samples: analysis.selectedTable?.columns.find((item) => item.key === column)?.samples ?? [], actions: ["METADATA", "IGNORE"] }),
        required: true,
      });
    const typeHeader = Object.entries(analysis.mappings).find(
      ([, field]) => field === "unitType",
    )?.[0];
    if (typeHeader)
      for (const raw of [
        ...new Set(
          analysis.rows
            .map((row) => String(row[typeHeader] ?? "").trim())
            .filter(Boolean),
        ),
      ])
        if (
          /^[A-Z]{1,3}$/.test(raw) &&
          !analysis.valueMappings.unitType?.[this.normalize(raw)]
        )
          issues.push({
            importId,
            severity: IssueSeverity.BLOCKING,
            field: `value:unitType:${raw}`,
            message: `ما معنى اختصار نوع الوحدة «${raw}»؟`,
            inputType: "ENUM_SELECT",
            options: this.json({ values: UNIT_TYPES, allowIgnore: true }),
            required: true,
          });
    for (const [header, canonical] of Object.entries(analysis.mappings)) {
      const missing = analysis.rows.filter(
        (r) => r[header] == null || r[header] === "",
      ).length;
      if (missing)
        issues.push({
          importId,
          severity:
            canonical === "externalUnitId"
              ? IssueSeverity.ERROR
              : IssueSeverity.WARNING,
          field: canonical,
          message: `${missing} rows are missing ${canonical}.`,
          inputType: "ENUM_SELECT",
          options: this.json({ values: ["LEAVE_EMPTY", "EXCLUDE_ROWS", "CONTACT_SALES"], missingRows: missing }),
          required: canonical === "externalUnitId",
          resolution: { missingRows: missing },
        });
    }
    if (aiUnavailable)
      issues.push({
        importId,
        severity: IssueSeverity.WARNING,
        field: "aiMapping",
        message:
          "AI-assisted column mapping is temporarily unavailable. Review unknown columns manually; the uploaded workbook is safe.",
        inputType: "CONFIRMATION",
        options: this.json({ values: ["ACKNOWLEDGED"] }),
        required: false,
      });
    if (issues.length) await prisma.importIssue.createMany({ data: issues });
  }

  async get(id: string): Promise<any> {
    const item = await this.prisma.dataImport.findUnique({
      where: { id },
      include: {
        issues: { orderBy: [{ severity: "desc" }, { id: "asc" }] },
        developer: true,
        project: true,
        uploadedBy: { select: { id: true, name: true, email: true } },
        unitChanges: {
          select: {
            id: true,
            unitId: true,
            operation: true,
            revertedAt: true,
            conflictReason: true,
          },
        },
        sheets: {
          orderBy: [{ sheetName: "asc" }, { startRow: "asc" }],
          include: { project: true, phase: true, developer: true, location: true, corrections: { orderBy: { createdAt: "desc" }, take: 5 } },
        },
        corrections: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!item) throw new NotFoundException("Import not found");
    const unfinished = !([ImportStatus.COMPLETED, ImportStatus.FAILED, ImportStatus.CANCELLED, ImportStatus.ROLLED_BACK] as ImportStatus[]).includes(item.status);
    const analysis = (item.analysis ?? {}) as Partial<Analysis> & { legacyStateDetected?: boolean; reconciledAt?: string };

    // Imports created before per-sheet persistence can be recovered from their source object.
    // Only unfinished batches are eligible; confirmed inventory is never rewritten here.
    if (unfinished && !item.sheets.length && analysis.fileKey) {
      const source = await this.storage.get(analysis.fileKey);
      const workbook = readImportWorkbook(source, item.fileName);
      const currentWorkbookAnalysis = analyzeWorkbook(workbook, item.fileName);
      const legacyMetadata = {
        ...(analysis.metadata ?? {}),
        projectId: item.projectId ?? analysis.metadata?.projectId ?? "",
        developerId: item.developerId ?? analysis.metadata?.developerId ?? "",
        locationId: analysis.metadata?.locationId ?? "",
        currency: String(analysis.defaultValues?.currency ?? ""),
      } as Record<string, string>;
      await this.prisma.dataImport.update({
        where: { id },
        data: {
          analysis: this.json({ ...analysis, workbookAnalysis: currentWorkbookAnalysis, legacyStateDetected: true, reconciledAt: new Date().toISOString() }),
          preview: Prisma.DbNull,
        },
      });
      return this.initializeImportSheets(id, currentWorkbookAnalysis, legacyMetadata, analysis.mappings ?? {});
    }

    if (unfinished && item.sheets.length) {
      const selectedIds = new Set(item.sheets.filter((sheet) => sheet.action === "IMPORT").map((sheet) => sheet.id));
      const staleIssues = item.issues.filter((issue) => {
        const match = String(issue.field ?? "").match(/^sheet:([^:]+):/);
        return !match || !selectedIds.has(match[1]);
      });
      if (staleIssues.length) {
        await this.prisma.importIssue.deleteMany({ where: { id: { in: staleIssues.map((issue) => issue.id) } } });
        for (const sheetId of selectedIds) await this.rebuildSheetIssues(sheetId);
        await this.prisma.dataImport.update({
          where: { id },
          data: {
            analysis: this.json({ ...analysis, legacyStateDetected: true, reconciledAt: new Date().toISOString() }),
            preview: Prisma.DbNull,
          },
        });
        return this.get(id);
      }
    }

    const result = this.withImportReadiness(item);
    if (unfinished && item.status !== result.workflow.status) {
      await this.prisma.dataImport.update({ where: { id }, data: { status: result.workflow.status } });
      return this.get(id);
    }
    return result;
  }

  private async refreshImportReadiness(id: string) {
    const refreshed = await this.get(id);
    const status = refreshed.workflow.status;
    await this.prisma.dataImport.update({
      where: { id },
      data: {
        status,
      },
    });
    return this.get(id);
  }
  async list(page = 1, pageSize = 50) {
    const safePage = Math.max(1, page);
    const take = Math.min(100, Math.max(1, pageSize));
    const [items, total] = await this.prisma.$transaction([
      this.prisma.dataImport.findMany({
        orderBy: { uploadedAt: "desc" },
        skip: (safePage - 1) * take,
        take,
        include: {
          developer: true,
          project: true,
          uploadedBy: { select: { id: true, name: true } },
          sheets: { select: { id: true, sheetName: true, action: true, classification: true, rowsCreated: true, rowsUpdated: true, project: { select: { name: true } } }, orderBy: { sheetName: "asc" } },
          _count: { select: { issues: true, unitChanges: true } },
        },
      }),
      this.prisma.dataImport.count(),
    ]);
    return { items, page: safePage, pageSize: take, total };
  }

  async options(type: string, search = "", page = 1, pageSize = 20) {
    const take = Math.min(50, Math.max(1, pageSize));
    const skip = (Math.max(1, page) - 1) * take;
    const contains = search.trim() || undefined;
    if (type === "projects") {
      const where: Prisma.ProjectWhereInput = contains ? { OR: [{ name: { contains, mode: "insensitive" } }, { developer: { name: { contains, mode: "insensitive" } } }, { location: { name: { contains, mode: "insensitive" } } }] } : {};
      const [items, total] = await this.prisma.$transaction([this.prisma.project.findMany({ where, skip, take, orderBy: { name: "asc" }, select: { id: true, name: true, developerId: true, locationId: true, developer: { select: { name: true } }, location: { select: { name: true } } } }), this.prisma.project.count({ where })]);
      return { items, total, page: Math.max(1, page), pageSize: take };
    }
    if (type === "developers") {
      const where: Prisma.DeveloperWhereInput = contains ? { name: { contains, mode: "insensitive" } } : {};
      const [items, total] = await this.prisma.$transaction([this.prisma.developer.findMany({ where, skip, take, orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } }), this.prisma.developer.count({ where })]);
      return { items, total, page: Math.max(1, page), pageSize: take };
    }
    if (type === "locations") {
      const where: Prisma.LocationWhereInput = contains ? { OR: [{ name: { contains, mode: "insensitive" } }, { aliases: { some: { value: { contains, mode: "insensitive" } } } }] } : {};
      const [items, total] = await this.prisma.$transaction([this.prisma.location.findMany({ where, skip, take, orderBy: { name: "asc" }, select: { id: true, name: true, type: true, parent: { select: { name: true } }, aliases: { select: { value: true }, take: 3 } } }), this.prisma.location.count({ where })]);
      return { items, total, page: Math.max(1, page), pageSize: take };
    }
    const staticOptions: Record<string, unknown> = { currencies: SUPPORTED_CURRENCIES, unitTypes: UNIT_TYPES, finishingTypes: FINISHING_TYPES, availability: AVAILABILITY_TYPES, canonicalFields: CANONICAL_FIELDS };
    if (type in staticOptions) return { items: staticOptions[type], total: (staticOptions[type] as readonly unknown[]).length, page: 1, pageSize: (staticOptions[type] as readonly unknown[]).length };
    throw new BadRequestException("نوع الخيارات غير مدعوم.");
  }

  async updateImportSheet(importId: string, sheetId: string, body: Record<string, unknown>) {
    const sheet = await this.prisma.importSheet.findFirst({ where: { id: sheetId, importId } });
    if (!sheet) throw new NotFoundException("Import sheet not found");
    if ((await this.prisma.dataImport.findUniqueOrThrow({ where: { id: importId }, select: { status: true } })).status === ImportStatus.COMPLETED)
      throw new BadRequestException("Use the correction workflow for a confirmed import.");
    const data: Prisma.ImportSheetUncheckedUpdateInput = {};
    let projectLocationBackfill: { projectId: string; locationId: string } | null = null;
    if (body.action != null) {
      if (!["IMPORT", "IGNORE"].includes(String(body.action))) throw new BadRequestException("Invalid sheet action");
      data.action = String(body.action);
    }
    if (body.projectId != null) {
      const project = await this.prisma.project.findUnique({ where: { id: String(body.projectId) }, select: { id: true, developerId: true, locationId: true } });
      if (!project) throw new BadRequestException("اختر مشروعاً موجوداً.");
      data.projectId = project.id;
      data.developerId = project.developerId;
      data.locationId = project.locationId;
      if (sheet.projectId !== project.id) data.phaseId = null;
    }
    if (body.phaseId !== undefined) {
      if (!body.phaseId) data.phaseId = null;
      else {
        const projectId = String(body.projectId ?? sheet.projectId ?? "");
        if (!projectId) throw new BadRequestException("اختر المشروع أولاً ثم المرحلة.");
        const phase = await this.prisma.projectPhase.findFirst({ where: { id: String(body.phaseId), projectId }, select: { id: true } });
        if (!phase) throw new BadRequestException("اختر مرحلة تابعة للمشروع المحدد.");
        data.phaseId = phase.id;
      }
    }
    if (body.developerId != null) {
      const developerId = String(body.developerId);
      if (body.projectId || sheet.projectId) {
        const project = await this.prisma.project.findUnique({ where: { id: String(body.projectId ?? sheet.projectId) }, select: { developerId: true } });
        if (project && project.developerId !== developerId) throw new BadRequestException("المطور المختار لا يملك المشروع المحدد.");
      }
      data.developerId = developerId;
    }
    if (body.locationId != null) {
      const locationId = String(body.locationId);
      const location = await this.prisma.location.findUnique({ where: { id: locationId }, select: { id: true } });
      if (!location) throw new BadRequestException("اختر موقعاً موجوداً.");
      const contextProjectId = String(body.projectId ?? sheet.projectId ?? "");
      if (contextProjectId) {
        const project = await this.prisma.project.findUnique({ where: { id: contextProjectId }, select: { locationId: true } });
        if (project?.locationId && project.locationId !== locationId) throw new BadRequestException("موقع الجدول يجب أن يطابق موقع المشروع. عدّل المشروع نفسه إذا تغيّر موقعه.");
        if (project && !project.locationId) projectLocationBackfill = { projectId: contextProjectId, locationId };
      }
      data.locationId = locationId;
    }
    if (body.defaultCurrency != null) {
      const currency = String(body.defaultCurrency).toUpperCase();
      if (!SUPPORTED_CURRENCIES.includes(currency as any)) throw new BadRequestException("اختر عملة مدعومة.");
      data.defaultCurrency = currency;
    }
    if (body.defaultUnitType !== undefined) data.defaultUnitType = body.defaultUnitType ? normalizeUnitType(body.defaultUnitType) : null;
    if (body.defaultIsResale !== undefined) {
      const value = typeof body.defaultIsResale === "boolean" ? body.defaultIsResale : String(body.defaultIsResale).toLowerCase() === "true";
      data.defaultIsResale = value;
    }
    if (body.headerRow != null) {
      const headerRow = Number(body.headerRow);
      if (!Number.isInteger(headerRow) || headerRow < 1) throw new BadRequestException("اختر صف عناوين صحيحاً.");
      const item = await this.prisma.dataImport.findUniqueOrThrow({ where: { id: importId }, select: { analysis: true } });
      const analysis = item.analysis as unknown as Analysis;
      if (!analysis.fileKey) throw new BadRequestException("Source workbook is unavailable.");
      const workbook = readImportWorkbook(await this.storage.get(analysis.fileKey), analysis.workbookAnalysis.workbookName);
      const sourceSheet = workbook.Sheets[sheet.sheetName];
      if (!sourceSheet) throw new BadRequestException("Worksheet no longer exists in the source workbook.");
      const table = detectTableAt(rawSheetMatrix(sourceSheet), sheet.sheetName, headerRow, .5);
      if (!table) throw new BadRequestException("لم يتم العثور على جدول صالح تحت صف العناوين المحدد.");
      const deterministic = this.deterministicSheetMappings(table);
      Object.assign(data, {
        tableId: table.id,
        headerRow: table.headerRow,
        startRow: table.startRow,
        endRow: table.endRow,
        rowsDetected: table.dataRowCount,
        columns: this.json(table.columns),
        mappings: this.json(deterministic.mappings),
        mappingSources: this.json(deterministic.sources),
        sourcePreview: this.json(table.previewRows),
      });
    }
    data.mappingVersion = { increment: 1 };
    data.previewMappingVersion = null;
    data.normalizedPreview = Prisma.DbNull;
    await this.prisma.$transaction(async (tx) => {
      if (projectLocationBackfill) await tx.project.update({ where: { id: projectLocationBackfill.projectId }, data: { locationId: projectLocationBackfill.locationId } });
      await tx.importSheet.update({ where: { id: sheetId }, data });
    });
    await this.rebuildSheetIssues(sheetId);
    return this.refreshImportReadiness(importId);
  }

  async updateSelectedSheets(importId: string, body: Record<string, unknown>) {
    const sheets = await this.prisma.importSheet.findMany({ where: { importId, action: "IMPORT" }, select: { id: true } });
    for (const sheet of sheets) await this.updateImportSheet(importId, sheet.id, body);
    return this.get(importId);
  }

  async markAllSheetsAsInventory(importId: string) {
    const sheets = await this.prisma.importSheet.findMany({ where: { importId }, select: { id: true } });
    for (const sheet of sheets) await this.updateImportSheet(importId, sheet.id, { action: "IMPORT" });
    return this.get(importId);
  }

  async updateImportSheetMapping(importId: string, sheetId: string, sourceColumn: string, canonicalField: string) {
    const sheet = await this.prisma.importSheet.findFirst({ where: { id: sheetId, importId } });
    if (!sheet) throw new NotFoundException("Import sheet not found");
    const item = await this.prisma.dataImport.findUniqueOrThrow({ where: { id: importId }, select: { status: true } });
    if (item.status === ImportStatus.COMPLETED) throw new BadRequestException("Use the correction workflow for a confirmed import.");
    const columns = (sheet.columns ?? []) as Array<{ key: string }>;
    if (!columns.some((column) => column.key === sourceColumn)) throw new BadRequestException("اختر عموداً موجوداً في الجدول.");
    const target = canonicalField === "METADATA" ? "__METADATA__" : canonicalField === "IGNORE" ? "__IGNORE__" : canonicalField;
    if (!["__METADATA__", "__IGNORE__"].includes(target) && !supportedMappingTarget(target)) throw new BadRequestException("اختر معنى مدعوماً للعمود أو احفظه كمعلومة مخصصة.");
    const mappings = { ...((sheet.mappings ?? {}) as Record<string, string>), [sourceColumn]: target };
    const sources = { ...((sheet.mappingSources ?? {}) as Record<string, string>), [sourceColumn]: "ADMIN_APPROVED" };
    await this.prisma.importSheet.update({
      where: { id: sheetId },
      data: { mappings: this.json(mappings), mappingSources: this.json(sources), ...(target === "phase" ? { phaseId: null } : {}), mappingVersion: { increment: 1 }, previewMappingVersion: null, normalizedPreview: Prisma.DbNull },
    });
    await this.rebuildSheetIssues(sheetId);
    return this.refreshImportReadiness(importId);
  }

  async createCorrection(importId: string, sheetId: string, sourceColumn: string, canonicalField: string, adminUserId?: string) {
    const item = await this.prisma.dataImport.findUniqueOrThrow({ where: { id: importId }, select: { status: true } });
    if (item.status !== ImportStatus.COMPLETED) throw new BadRequestException("Corrections are only required after a confirmed import.");
    const sheet = await this.prisma.importSheet.findFirst({ where: { id: sheetId, importId } });
    if (!sheet) throw new NotFoundException("Import sheet not found");
    const columns = (sheet.columns ?? []) as Array<{ key: string }>;
    if (!columns.some((column) => column.key === sourceColumn)) throw new BadRequestException("اختر عموداً موجوداً.");
    const target = canonicalField === "METADATA" ? "__METADATA__" : canonicalField === "IGNORE" ? "__IGNORE__" : canonicalField;
    if (!["__METADATA__", "__IGNORE__"].includes(target) && !supportedMappingTarget(target)) throw new BadRequestException("اختر معنى مدعوماً.");
    const oldMappings = (sheet.mappings ?? {}) as Record<string, string>;
    const previousTarget = oldMappings[sourceColumn];
    const metadataTarget = (value?: string) => Boolean(value && (value === "__METADATA__" || isCustomMetadataField(value) || CANONICAL_FIELD_MAP.get(value)?.storage === "METADATA"));
    if (metadataTarget(previousTarget) || metadataTarget(target)) throw new BadRequestException("تصحيح حقول metadata بعد اعتماد الدفعة يتم عبر استيراد تحديث جديد حتى نحافظ على provenance وsourceMetadata بدون فقد بيانات.");
    if (previousTarget === "externalUnitId" || target === "externalUnitId") throw new BadRequestException("تصحيح كود الهوية يحتاج استيراد تحديث جديداً لتجنب دمج وحدات مختلفة.");
    const proposedMappings = { ...oldMappings, [sourceColumn]: target };
    return this.prisma.importCorrection.create({ data: { importId, importSheetId: sheetId, createdByAdminId: adminUserId, oldMappings: this.json(oldMappings), proposedMappings: this.json(proposedMappings) } });
  }

  async previewCorrection(importId: string, correctionId: string) {
    const correction = await this.prisma.importCorrection.findFirst({ where: { id: correctionId, importId }, include: { import: true, importSheet: true } });
    if (!correction) throw new NotFoundException("Correction not found");
    const analysis = correction.import.analysis as unknown as Analysis;
    if (!analysis.fileKey) throw new BadRequestException("Source workbook is unavailable.");
    const workbook = readImportWorkbook(await this.storage.get(analysis.fileKey), analysis.workbookAnalysis.workbookName);
    const sheet = correction.importSheet;
    const rows = recordsForTable(workbook, this.persistedTable(sheet));
    const oldMappings = correction.oldMappings as Record<string, string>;
    const proposedMappings = correction.proposedMappings as Record<string, string>;
    const changedSources = [...new Set([...Object.keys(oldMappings), ...Object.keys(proposedMappings)])].filter((source) => oldMappings[source] !== proposedMappings[source]);
    const affectedFields = [...new Set(changedSources.flatMap((source) => [oldMappings[source], proposedMappings[source]]).filter((field) => INVENTORY_CANONICAL.includes(field) && field !== "externalUnitId"))];
    const changes = await this.prisma.importUnitChange.findMany({ where: { importId, importSheetId: sheet.id }, include: { unit: true } });
    await this.prisma.importCorrectionChange.deleteMany({ where: { correctionId } });
    let affected = 0, conflicts = 0, unchanged = 0;
    const previewChanges: Array<{ unitId: string; externalUnitId: string; conflict: boolean; current: Record<string, unknown>; corrected: Record<string, unknown> }> = [];
    for (const change of changes) {
      if (!change.unit) continue;
      const row = rows.find((candidate) => {
        const identitySource = Object.entries(proposedMappings).find(([, target]) => target === "externalUnitId")?.[0];
        return identitySource && String(candidate[identitySource] ?? "").trim() === change.unit!.externalUnitId;
      });
      if (!row) continue;
      const proposedSheet = { ...sheet, mappings: proposedMappings };
      const normalized = this.valuesForSheet(row, proposedSheet).values;
      const corrected: Record<string, unknown> = {};
      for (const field of affectedFields) corrected[field] = normalized[field] == null || normalized[field] === "" ? null : (this.unitData({ [field]: normalized[field] }, false) as any)[field] ?? normalized[field];
      const imported = ((change.afterData as any)?.unit ?? {}) as Record<string, unknown>;
      const current = change.unit as unknown as Record<string, unknown>;
      const conflict = affectedFields.some((field) => !this.sameValue(current[field], imported[field]));
      const changed = affectedFields.some((field) => !this.sameValue(current[field], corrected[field]));
      if (!changed) { unchanged++; continue; }
      affected++;
      if (conflict) conflicts++;
      previewChanges.push({ unitId: change.unit.id, externalUnitId: change.unit.externalUnitId, conflict, current: Object.fromEntries(affectedFields.map((field) => [field, current[field]])), corrected });
      await this.prisma.importCorrectionChange.create({ data: { correctionId, unitId: change.unit.id, beforeData: this.json(imported), correctedData: this.json(corrected), currentData: this.json(Object.fromEntries(affectedFields.map((field) => [field, current[field]]))), conflict } });
    }
    const preview = { affected, conflicts, unchanged, affectedFields, canConfirm: affected > 0 };
    await this.prisma.importCorrection.update({ where: { id: correctionId }, data: { status: "PREVIEW_READY", preview: this.json(preview) } });
    return { correctionId, ...preview, changes: previewChanges };
  }

  async confirmCorrection(importId: string, correctionId: string, decisions: Record<string, string> = {}) {
    const correction = await this.prisma.importCorrection.findFirst({ where: { id: correctionId, importId }, include: { importSheet: true, changes: true } });
    if (!correction || correction.status !== "PREVIEW_READY") throw new BadRequestException("Generate a correction preview first.");
    const result = await this.prisma.$transaction(async (tx) => {
      let applied = 0, conflictsKept = 0, skipped = 0;
      for (const change of correction.changes) {
        const decision = decisions[change.unitId ?? ""] ?? (change.conflict ? "KEEP_CURRENT" : "APPLY_CORRECTED");
        if (decision !== "APPLY_CORRECTED") {
          decision === "KEEP_CURRENT" ? conflictsKept++ : skipped++;
          await tx.importCorrectionChange.update({ where: { id: change.id }, data: { decision } });
          continue;
        }
        if (change.unitId) await tx.unit.update({ where: { id: change.unitId }, data: change.correctedData as Prisma.UnitUncheckedUpdateInput });
        await tx.importCorrectionChange.update({ where: { id: change.id }, data: { decision, appliedAt: new Date() } });
        applied++;
      }
      const proposedMappings = correction.proposedMappings as Record<string, string>;
      const sources = { ...((correction.importSheet.mappingSources ?? {}) as Record<string, string>) };
      for (const source of Object.keys(proposedMappings)) sources[source] = "ADMIN_CORRECTION";
      await tx.importSheet.update({ where: { id: correction.importSheetId }, data: { mappings: this.json(proposedMappings), mappingSources: this.json(sources), mappingVersion: { increment: 1 } } });
      const developer = correction.importSheet.developerId ? await tx.developer.findUnique({ where: { id: correction.importSheet.developerId }, select: { slug: true } }) : null;
      if (developer) for (const [sourceColumn, canonicalField] of Object.entries(proposedMappings)) if (INVENTORY_CANONICAL.includes(canonicalField)) await tx.importMapping.upsert({ where: { developerSlug_normalizedColumn: { developerSlug: developer.slug, normalizedColumn: this.normalize(sourceColumn) } }, create: { developerSlug: developer.slug, sourceColumn, normalizedColumn: this.normalize(sourceColumn), canonicalField, approved: true, confidence: 1 }, update: { canonicalField, approved: true, confidence: 1 } });
      await tx.importCorrection.update({ where: { id: correctionId }, data: { status: "CONFIRMED", conflictDecisions: this.json(decisions), confirmedAt: new Date() } });
      return { applied, conflictsKept, skipped, conflicts: correction.changes.filter((change) => change.conflict).length };
    });
    this.cache?.invalidateCustomerData();
    return result;
  }

  private async reselectWorkbookTable(id: string, analysis: Analysis, value: unknown) {
    const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const sheetName = String(input.sheetName ?? "");
    const headerRow = Number(input.headerRow);
    if (!analysis.fileKey || !sheetName || !Number.isInteger(headerRow) || headerRow < 1)
      throw new BadRequestException("اختر صفحة وصف عناوين صحيحًا.");
    const buffer = await this.storage.get(analysis.fileKey);
    const workbook = readImportWorkbook(buffer, analysis.workbookAnalysis.workbookName);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new BadRequestException("الصفحة المختارة غير موجودة في الملف.");
    const table = detectTableAt(rawSheetMatrix(sheet), sheetName, headerRow, 1);
    if (!table) throw new BadRequestException("لم نتمكن من تكوين جدول صالح من صف العناوين المختار.");
    const headers = table.columns.map((column) => column.key);
    const rows = recordsForTable(workbook, table);
    if (!rows.length) throw new BadRequestException("صف العناوين المختار لا يحتوي على صفوف بيانات صالحة تحته.");
    const developerSlug = analysis.metadata.developerSlug || "__global__";
    const remembered = await this.prisma.importMapping.findMany({ where: { approved: true, developerSlug: { in: [developerSlug, "__global__"] } } });
    const mappings: Record<string, string> = {};
    const mappingSources: Record<string, string> = {};
    const mappingConfidence: Record<string, number> = {};
    const paymentPlanMappings: Analysis["paymentPlanMappings"] = {};
    for (const column of table.columns) {
      const prior = remembered.find((mapping) => mapping.normalizedColumn === this.normalize(column.originalHeader));
      const semantic = column.semanticField ? { field: column.semanticField, confidence: column.confidence } : detectSemanticColumn(column.originalHeader);
      const canonical = prior?.canonicalField ?? KNOWN[this.normalize(column.originalHeader)] ?? semantic?.field;
      if (canonical?.startsWith("paymentPlan:")) {
        const [, duration, valueType = "TOTAL_PRICE"] = canonical.split(":");
        paymentPlanMappings[column.key] = { durationMonths: Number(duration) || undefined, valueType: valueType as PaymentPlanValueType, sourceDurationText: column.originalHeader, approved: true };
      } else if (canonical && CANONICAL.includes(canonical)) {
        mappings[column.key] = canonical;
        mappingSources[column.key] = prior ? "ADMIN_APPROVED_MEMORY" : "KNOWN_RULE";
        mappingConfidence[column.key] = prior ? Number(prior.confidence ?? 1) : semantic?.confidence ?? .8;
      } else {
        const plan = parsePaymentPlanComponentHeader(column.originalHeader);
        if (plan) paymentPlanMappings[column.key] = { ...plan, approved: false };
      }
    }
    analysis.sheetName = sheetName;
    analysis.selectedTable = table;
    analysis.headers = headers;
    analysis.rows = this.json(rows);
    analysis.mappings = mappings;
    analysis.mappingSources = mappingSources;
    analysis.mappingConfidence = mappingConfidence;
    analysis.paymentPlanMappings = paymentPlanMappings;
    analysis.unknownColumns = headers.filter((header) => !mappings[header] && !paymentPlanMappings[header]);
    analysis.workbookAnalysis.selectedSheet = sheetName;
    analysis.workbookAnalysis.selectedTableId = table.id;
    await this.prisma.$transaction(async (tx) => {
      await tx.importIssue.deleteMany({ where: { importId: id } });
      await tx.dataImport.update({ where: { id }, data: { rowsDetected: rows.length, status: ImportStatus.NEEDS_INPUT, analysis: this.json(analysis), mappingConfig: this.json({ mappings, mappingSources, mappingConfidence }) } });
      await this.createIssues(id, analysis, tx);
    });
    return this.refreshImportReadiness(id);
  }

  async resolve(id: string, field: string, value: unknown) {
    const item = await this.get(id);
    const analysis = item.analysis as unknown as Analysis;
    if (field === "workbook:selection") return this.reselectWorkbookTable(id, analysis, value);
    analysis.paymentPlanMappings ??= {};
    const resolvedFields = [field];
    if (field.startsWith("column:")) {
      const header = field.slice(7);
      if (value === "IGNORE") {
        analysis.unknownColumns = analysis.unknownColumns.filter(
          (x) => x !== header,
        );
        (analysis.ignoredColumns ??= []).push(header);
      } else if (value === "METADATA") {
        analysis.unknownColumns = analysis.unknownColumns.filter((x) => x !== header);
        (analysis.metadataColumns ??= []).push(header);
      } else {
        if (!CANONICAL.includes(String(value)))
          throw new BadRequestException("Invalid canonical field");
        analysis.mappings[header] = String(value);
        analysis.mappingSources[header] = "ADMIN_APPROVED";
        analysis.unknownColumns = analysis.unknownColumns.filter(
          (x) => x !== header,
        );
      }
    } else if (field.startsWith("mapping:")) {
      const canonical = field.slice(8);
      const header = String(value);
      if (!analysis.headers.includes(header) || !CANONICAL.includes(canonical))
        throw new BadRequestException("Choose an existing source header");
      analysis.mappings[header] = canonical;
      analysis.mappingSources[header] = "ADMIN_APPROVED";
      analysis.unknownColumns = analysis.unknownColumns.filter(
        (x) => x !== header,
      );
    } else if (field.startsWith("paymentPlan:")) {
      const header = field.slice("paymentPlan:".length);
      const input = value as Record<string, unknown>;
      const durationMonths = input?.durationMonths == null || input.durationMonths === "" ? undefined : Number(input.durationMonths);
      const valueType = String(input?.valueType ?? "TOTAL_PRICE");
      const currency = input?.currency ? String(input.currency).toUpperCase() : undefined;
      if (!analysis.headers.includes(header) || (durationMonths != null && (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 360)))
        throw new BadRequestException("اختر مدة سداد صحيحة بين شهر واحد و360 شهراً.");
      if (!["TOTAL_PRICE", "INSTALLMENT_AMOUNT", "DOWN_PAYMENT_AMOUNT", "DOWN_PAYMENT_PERCENT", "MAINTENANCE_AMOUNT", "MAINTENANCE_PERCENT"].includes(valueType))
        throw new BadRequestException("اختر نوع قيمة خطة السداد.");
      if (currency && !SUPPORTED_CURRENCIES.includes(currency as any))
        throw new BadRequestException("اختر عملة مدعومة.");
      analysis.paymentPlanMappings[header] = {
        durationMonths,
        valueType: valueType as PaymentPlanValueType,
        currency,
        sourceDurationText: analysis.paymentPlanMappings[header]?.sourceDurationText ?? header,
        approved: true,
      };
    } else if (field.startsWith("value:")) {
      const [, canonical, raw] = field.split(":");
      if (value !== "IGNORE")
        (analysis.valueMappings[canonical] ??= {})[this.normalize(raw)] =
          String(value);
    } else if (field === "projectId") {
      const project = await this.prisma.project.findUnique({
        where: { id: String(value) },
        select: { id: true, developerId: true, locationId: true, developer: { select: { slug: true } } },
      });
      if (!project) throw new BadRequestException("اختر مشروعاً موجوداً.");
      analysis.metadata.projectId = project.id;
      analysis.metadata.developerId = project.developerId;
      analysis.metadata.developerSlug = project.developer.slug;
      if (project.locationId) analysis.metadata.locationId = project.locationId;
      const remembered = await this.prisma.importMapping.findMany({ where: { approved: true, developerSlug: { in: [project.developer.slug, "__global__"] } } });
      for (const header of analysis.headers) {
        const prior = remembered.find((mapping) => mapping.normalizedColumn === this.normalize(header));
        if (!prior) continue;
        if (prior.canonicalField.startsWith("paymentPlan:")) {
          const [, duration, valueType = "TOTAL_PRICE"] = prior.canonicalField.split(":");
          analysis.paymentPlanMappings[header] = { durationMonths: Number(duration) || undefined, valueType: valueType as PaymentPlanValueType, sourceDurationText: header, approved: true };
          resolvedFields.push(`paymentPlan:${header}`);
        } else if (CANONICAL.includes(prior.canonicalField)) {
          analysis.mappings[header] = prior.canonicalField;
          analysis.mappingSources[header] = "ADMIN_APPROVED_MEMORY";
        }
        analysis.unknownColumns = analysis.unknownColumns.filter((column) => column !== header);
        resolvedFields.push(`column:${header}`);
      }
      resolvedFields.push("developerId");
      if (project.locationId) resolvedFields.push("locationId");
      await this.prisma.dataImport.update({ where: { id }, data: { projectId: project.id, developerId: project.developerId } });
    } else if (field === "developerId") {
      const developer = await this.prisma.developer.findUnique({ where: { id: String(value) }, select: { id: true, slug: true } });
      if (!developer) throw new BadRequestException("اختر مطوراً موجوداً.");
      analysis.metadata.developerId = developer.id;
      analysis.metadata.developerSlug = developer.slug;
      await this.prisma.dataImport.update({ where: { id }, data: { developerId: developer.id } });
    } else if (field === "locationId") {
      const location = await this.prisma.location.findUnique({ where: { id: String(value) }, select: { id: true } });
      if (!location) throw new BadRequestException("اختر منطقة موجودة.");
      analysis.metadata.locationId = location.id;
    } else if (field === "currency") {
      const currency = String(value).toUpperCase();
      if (!SUPPORTED_CURRENCIES.includes(currency as any)) throw new BadRequestException("اختر عملة مدعومة.");
      analysis.defaultValues.currency = currency;
    } else if (
      [
        "projectName",
        "developerName",
        "parentImportId",
      ].includes(field)
    )
      analysis.metadata[field] = String(value);
    else if (
      field === "missingUnitPolicy" &&
      ["LEAVE_UNCHANGED", "MARK_UNAVAILABLE", "ARCHIVE"].includes(String(value))
    )
      await this.prisma.dataImport.update({
        where: { id },
        data: { missingUnitPolicy: String(value) },
      });
    else if (
      ["LEAVE_EMPTY", "EXCLUDE_ROWS", "CONTACT_SALES"].includes(String(value))
    )
      analysis.rowPolicies[field] = String(value);
    else analysis.defaultValues[field] = value;
    await this.prisma.$transaction([
      this.prisma.dataImport.update({
        where: { id },
        data: {
          analysis: this.json(analysis),
          mappingConfig: this.json({
            mappings: analysis.mappings,
            mappingSources: analysis.mappingSources,
          }),
        },
      }),
      this.prisma.importIssue.updateMany({
        where: { importId: id, field: { in: resolvedFields } },
        data: { resolvedAt: new Date(), resolution: this.json({ value }) },
      }),
    ]);
    return this.refreshImportReadiness(id);
  }

  private persistedTable(sheet: any): DetectedTable {
    const columns = (sheet.columns ?? []) as DetectedTable["columns"];
    return {
      id: sheet.tableId ?? `${sheet.sheetName}:${sheet.headerRow}:persisted`,
      sheetName: sheet.sheetName,
      headerRow: sheet.headerRow,
      startRow: sheet.startRow ?? sheet.headerRow,
      endRow: sheet.endRow,
      startColumn: Math.min(...columns.map((column) => column.columnIndex)) + 1,
      endColumn: Math.max(...columns.map((column) => column.columnIndex)) + 1,
      dataRowCount: sheet.rowsDetected,
      confidence: sheet.confidence,
      columns,
      previewRows: (sheet.sourcePreview ?? []) as Record<string, any>[],
      ignoredRowsAbove: Math.max(0, sheet.headerRow - 1),
      ignoredRowsBelow: 0,
      warnings: [],
    };
  }

  private phaseSourceColumn(sheet: any) {
    return Object.entries((sheet.mappings ?? {}) as Record<string, string>).find(([, target]) => target === "phase")?.[0];
  }

  private resolveStructuredPhase(
    values: Record<string, unknown>,
    phases: Array<{ id: string; code: string | null; name: string; nameAr: string | null; nameEn: string | null }>,
    fallbackPhaseId?: string | null,
    aliases: Array<{ normalizedValue: string; phaseId: string }> = [],
  ) {
    const raw = String(values.phase ?? "").trim();
    if (!raw) return { phaseId: fallbackPhaseId ?? undefined, unmatched: !fallbackPhaseId, source: fallbackPhaseId ? "SHEET_DEFAULT" : "EMPTY" };
    const needle = this.normalizePhaseValue(raw);
    const alias = aliases.find((item) => item.normalizedValue === needle);
    if (alias && phases.some((phase) => phase.id === alias.phaseId)) return { phaseId: alias.phaseId, unmatched: false, source: "ALIAS" };
    const direct = phases.find((phase) => [phase.code, phase.name, phase.nameAr, phase.nameEn].filter(Boolean).some((candidate) => this.normalizePhaseValue(String(candidate)) === needle));
    if (direct) return { phaseId: direct.id, unmatched: false, source: "DIRECT" };
    return { phaseId: undefined, unmatched: true, source: "UNMATCHED" };
  }

  private async phaseValuesForSheetRecord(sheet: any) {
    const sourceColumn = this.phaseSourceColumn(sheet);
    if (!sourceColumn || !sheet.projectId) return { mode: sourceColumn ? "COLUMN" : "SINGLE", sourceColumn: sourceColumn ?? null, sourceHeader: null, totalRows: sheet.rowsDetected ?? 0, uniqueCount: 0, matchedCount: 0, unmatchedCount: 0, values: [] as any[] };
    const item = await this.prisma.dataImport.findUniqueOrThrow({ where: { id: sheet.importId }, select: { analysis: true, fileName: true } });
    const analysis = item.analysis as unknown as Analysis;
    if (!analysis.fileKey) throw new BadRequestException("Source workbook is unavailable.");
    const workbook = readImportWorkbook(await this.storage.get(analysis.fileKey), analysis.workbookAnalysis.workbookName || item.fileName);
    const rows = recordsForTable(workbook, this.persistedTable(sheet));
    const counts = new Map<string, { sourceValue: string; count: number }>();
    for (const row of rows) {
      const raw = String(row[sourceColumn] ?? "").trim();
      if (!raw) continue;
      const normalized = this.normalizePhaseValue(raw);
      const current = counts.get(normalized);
      if (current) current.count += 1;
      else counts.set(normalized, { sourceValue: raw, count: 1 });
    }
    const [phases, aliases] = await Promise.all([
      this.prisma.projectPhase.findMany({ where: { projectId: sheet.projectId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, code: true, name: true, nameAr: true, nameEn: true } }),
      this.prisma.projectPhaseAlias.findMany({ where: { projectId: sheet.projectId }, select: { normalizedValue: true, phaseId: true, value: true } }),
    ]);
    const values = [...counts.entries()].map(([normalizedValue, value]) => {
      const resolved = this.resolveStructuredPhase({ phase: value.sourceValue }, phases, null, aliases);
      const phase = resolved.phaseId ? phases.find((item) => item.id === resolved.phaseId) : undefined;
      return { normalizedValue, sourceValue: value.sourceValue, count: value.count, matched: Boolean(phase), phaseId: phase?.id ?? null, phaseName: phase?.name ?? null, phaseCode: phase?.code ?? null, matchSource: resolved.source };
    }).sort((a, b) => b.count - a.count || a.sourceValue.localeCompare(b.sourceValue));
    const column = ((sheet.columns ?? []) as Array<{ key: string; originalHeader: string }>).find((item) => item.key === sourceColumn);
    return {
      mode: "COLUMN",
      sourceColumn,
      sourceHeader: column?.originalHeader ?? sourceColumn,
      totalRows: rows.length,
      uniqueCount: values.length,
      matchedCount: values.filter((value) => value.matched).length,
      unmatchedCount: values.filter((value) => !value.matched).length,
      values,
      phases: phases.map((phase) => ({ id: phase.id, name: phase.name, code: phase.code })),
    };
  }

  async getPhaseValues(importId: string, sheetId: string) {
    const sheet = await this.prisma.importSheet.findFirst({ where: { id: sheetId, importId } });
    if (!sheet) throw new NotFoundException("Import sheet not found");
    return this.phaseValuesForSheetRecord(sheet);
  }

  async mapPhaseValue(importId: string, sheetId: string, sourceValue: string, phaseId: string) {
    const sheet = await this.prisma.importSheet.findFirst({ where: { id: sheetId, importId } });
    if (!sheet) throw new NotFoundException("Import sheet not found");
    if (!sheet.projectId) throw new BadRequestException("اختر المشروع أولاً.");
    if (!this.phaseSourceColumn(sheet)) throw new BadRequestException("اربط عمود المراحل بحقل «المرحلة» أولاً.");
    const value = String(sourceValue ?? "").trim();
    if (!value) throw new BadRequestException("اختر قيمة مرحلة من الملف.");
    const phase = await this.prisma.projectPhase.findFirst({ where: { id: String(phaseId), projectId: sheet.projectId }, select: { id: true } });
    if (!phase) throw new BadRequestException("اختر مرحلة تابعة للمشروع المحدد.");
    const normalizedValue = this.normalizePhaseValue(value);
    await this.prisma.$transaction([
      this.prisma.projectPhaseAlias.upsert({
        where: { projectId_normalizedValue: { projectId: sheet.projectId, normalizedValue } },
        create: { projectId: sheet.projectId, phaseId: phase.id, value, normalizedValue, source: "IMPORT_ADMIN" },
        update: { phaseId: phase.id, value, source: "IMPORT_ADMIN" },
      }),
      this.prisma.importSheet.update({ where: { id: sheet.id }, data: { mappingVersion: { increment: 1 }, previewMappingVersion: null, normalizedPreview: Prisma.DbNull } }),
      this.prisma.dataImport.update({ where: { id: importId }, data: { preview: Prisma.DbNull, status: ImportStatus.NEEDS_INPUT } }),
    ]);
    await this.rebuildSheetIssues(sheet.id);
    return this.refreshImportReadiness(importId);
  }

  private valuesForSheet(row: Record<string, unknown>, sheet: any) {
    const values: Record<string, unknown> = {};
    if (sheet.defaultCurrency) values.currency = sheet.defaultCurrency;
    if (sheet.defaultUnitType) values.unitType = sheet.defaultUnitType;
    if (sheet.phaseId) values.phaseId = sheet.phaseId;
    values.isResale = Boolean(sheet.defaultIsResale);
    const metadata: Record<string, unknown> = {};
    for (const [source, target] of Object.entries((sheet.mappings ?? {}) as Record<string, string>)) {
      const raw = row[source];
      if (raw == null || raw === "" || target === "__IGNORE__") continue;
      if (target === "__METADATA__") { metadata[source] = raw; continue; }
      if (isCustomMetadataField(target)) { metadata[customMetadataLabel(target) || source] = raw; continue; }
      if (METADATA_CANONICAL.has(target) || CANONICAL_FIELD_MAP.get(target)?.storage === "METADATA") { metadata[target] = raw; continue; }
      if (target === "deliveryDate") {
        const date = parseImportDate(raw);
        const durationYears = date ? undefined : parseDeliveryDurationYears(raw);
        if (durationYears != null) { values.deliveryYears = durationYears; metadata.deliverySourceValue = raw; continue; }
      }
      if (target === "deliveryYears") {
        const durationYears = parseDeliveryDurationYears(raw);
        values.deliveryYears = durationYears ?? raw;
        continue;
      }
      values[target] = raw;
    }
    return { values, metadata };
  }

  private sheetValueErrors(values: Record<string, unknown>) {
    const errors: Array<{ field: string; code: string }> = [];
    if (!String(values.externalUnitId ?? "").trim()) errors.push({ field: "externalUnitId", code: "MISSING_IDENTITY" });
    for (const field of ["bedrooms", "bathrooms", "builtUpArea", "landArea", "gardenArea", "roofArea", "terraceArea", "price", "maintenance", "clubFees", "discount"])
      if (values[field] != null && values[field] !== "" && this.number(values[field]) == null) errors.push({ field, code: "INVALID_NUMBER" });
    if (values.deliveryDate != null && values.deliveryDate !== "" && !parseImportDate(values.deliveryDate)) errors.push({ field: "deliveryDate", code: "INVALID_DATE" });
    if (values.deliveryYears != null && values.deliveryYears !== "" && parseDeliveryDurationYears(values.deliveryYears) == null && this.number(values.deliveryYears) == null) errors.push({ field: "deliveryYears", code: "INVALID_DURATION" });
    if (values.currency && !SUPPORTED_CURRENCIES.includes(String(values.currency).toUpperCase() as any)) errors.push({ field: "currency", code: "INVALID_CURRENCY" });
    return errors;
  }

  private summarizeSheetValidation(rows: Array<{ rowNumber: number; errors: Array<{ field: string; code: string }> }>) {
    const grouped = new Map<string, { field: string; code: string; count: number; sampleRows: number[] }>();
    for (const row of rows) for (const error of row.errors) {
      const key = `${error.field}:${error.code}`;
      const current = grouped.get(key) ?? { ...error, count: 0, sampleRows: [] };
      current.count += 1;
      if (current.sampleRows.length < 5) current.sampleRows.push(row.rowNumber);
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.count - a.count);
  }

  private async previewSheets(item: any) {
    if (!item.workflow.canPreview)
      throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_VALIDATION_ISSUES", "راجع كل الجداول المختارة وأكمل البيانات المطلوبة قبل إنشاء المعاينة.", "validation", item.id);
    const analysis = item.analysis as Analysis;
    if (!analysis.fileKey) throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_VALIDATION_ISSUES", "Source workbook is unavailable.", "validation", item.id);
    const workbook = readImportWorkbook(await this.storage.get(analysis.fileKey), analysis.workbookAnalysis.workbookName);
    const selected = item.sheets.filter((sheet: any) => sheet.action === "IMPORT");
    const summaries: any[] = [];
    let totalValid = 0, totalInvalid = 0, totalNew = 0, totalExisting = 0;
    const seen = new Set<string>();
    for (const sheet of selected) {
      const rows = recordsForTable(workbook, this.persistedTable(sheet));
      const [phases, phaseAliases] = await Promise.all([
        this.prisma.projectPhase.findMany({ where: { projectId: sheet.projectId! }, select: { id: true, code: true, name: true, nameAr: true, nameEn: true } }),
        this.prisma.projectPhaseAlias.findMany({ where: { projectId: sheet.projectId! }, select: { normalizedValue: true, phaseId: true } }),
      ]);
      const columns = (sheet.columns ?? []) as Array<{ key: string; originalHeader: string; samples?: unknown[] }>;
      const mappings = (sheet.mappings ?? {}) as Record<string, string>;
      const mappingAdjustments = columns.flatMap((column) => {
        const mapped = mappings[column.key];
        if (!mapped) return [];
        const effective = refineCanonicalFieldBySamples(mapped, column.samples ?? []);
        return effective !== mapped ? [{ sourceColumn: column.originalHeader, sourceKey: column.key, mappedField: mapped, effectiveField: effective, reason: "VALUE_SHAPE" }] : [];
      });
      const normalized = rows.map((row, index) => {
        const entry = this.valuesForSheet(row, sheet);
        const resolved = this.resolveStructuredPhase(entry.values, phases, sheet.phaseId, phaseAliases);
        if (resolved.phaseId) entry.values.phaseId = resolved.phaseId;
        const errors = this.sheetValueErrors(entry.values);
        if (resolved.unmatched) errors.push({ field: "phase", code: "UNMATCHED_PHASE" });
        return { ...entry, phaseUnmatched: resolved.unmatched, rowNumber: Number(sheet.headerRow ?? 1) + index + 1, errors };
      });
      const readyRows = normalized.filter(({ errors }) => errors.length === 0);
      const blockedRows = normalized.filter(({ errors }) => errors.length > 0);
      const validationSummary = this.summarizeSheetValidation(blockedRows);
      let duplicates = 0;
      for (const { values } of readyRows) {
        const key = `${sheet.projectId}:${String(values.externalUnitId).trim()}`;
        if (seen.has(key)) duplicates++;
        seen.add(key);
      }
      const identifiers = readyRows.map(({ values }) => String(values.externalUnitId).trim());
      const existing = identifiers.length ? await this.prisma.unit.count({ where: { projectId: sheet.projectId!, developerId: sheet.developerId!, externalUnitId: { in: identifiers } } }) : 0;
      const summary = {
        sheetId: sheet.id,
        sheetName: sheet.sheetName,
        projectId: sheet.projectId,
        project: sheet.project?.name,
        rowsFound: rows.length,
        sourceRows: rows.length,
        readyRows: readyRows.length,
        needsReviewRows: blockedRows.length,
        valid: readyRows.length,
        invalidRows: blockedRows.length,
        duplicates,
        newUnits: readyRows.length - existing,
        existingUnits: existing,
        validationSummary,
        mappingAdjustments,
        mappingVersion: sheet.mappingVersion,
        sourcePreview: sheet.sourcePreview,
        normalizedRows: readyRows.slice(0, 10).map(({ values }) => { const { phaseId: _phaseId, ...visible } = values; return visible; }),
      };
      summaries.push(summary);
      totalValid += readyRows.length;
      totalInvalid += blockedRows.length + duplicates;
      totalNew += readyRows.length - existing;
      totalExisting += existing;
      await this.prisma.importSheet.update({ where: { id: sheet.id }, data: { normalizedPreview: this.json(summary), previewMappingVersion: sheet.mappingVersion } });
    }
    const preview = {
      engineVersion: IMPORT_PREVIEW_ENGINE_VERSION,
      sheets: summaries,
      selectedSheetCount: selected.length,
      sourceRows: summaries.reduce((sum, sheet) => sum + Number(sheet.sourceRows ?? 0), 0),
      readyRows: totalValid,
      needsReviewRows: totalInvalid,
      valid: totalValid,
      invalidRows: totalInvalid,
      newUnits: totalNew,
      existingUnits: totalExisting,
      paymentPlanCount: 0,
      blockingIssues: totalInvalid,
      canConfirm: totalInvalid === 0 && selected.length > 0,
    };
    await this.prisma.dataImport.update({ where: { id: item.id }, data: { preview: this.json(preview), status: preview.canConfirm ? ImportStatus.READY : ImportStatus.NEEDS_INPUT } });
    return this.get(item.id);
  }

  async preview(id: string) {
    const item = await this.get(id);
    if (item.sheets.length) return this.previewSheets(item);
    if (!item.workflow.canPreview)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_VALIDATION_ISSUES",
        "Resolve all blocking import questions and required context before generating a preview.",
        "validation",
        id,
      );
    const analysis = item.analysis as unknown as Analysis;
    const blocking = item.issues.filter(
      (i: any) => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt,
    ).length;
    const externalHeader = Object.entries(analysis.mappings).find(
      ([, v]) => v === "externalUnitId",
    )?.[0];
    const identifiers = externalHeader
      ? analysis.rows
          .map((row) => String(row[externalHeader] ?? "").trim())
          .filter(Boolean)
      : [];
    const uniqueIdentifiers = new Set(identifiers);
    const duplicateIdentifiers = identifiers.length - uniqueIdentifiers.size;
    const developerId = item.developerId || analysis.metadata.developerId;
    const projectId = item.projectId || analysis.metadata.projectId;
    const existing =
      developerId && projectId
        ? await this.prisma.unit.findMany({
            where: { developerId, projectId },
            include: {
              paymentPlans: { where: { isActive: true } },
              offers: { where: { isActive: true } },
            },
          })
        : [];
    const existingById = new Map(
      existing.map((unit) => [unit.externalUnitId, unit]),
    );
    let newUnits = 0,
      existingUnits = 0,
      priceChanges = 0,
      availabilityChanges = 0,
      paymentPlanChanges = 0,
      updatedUnits = 0,
      invalidRows = 0;
    const validationErrors: unknown[] = [];
    const changeExamples: unknown[] = [];
    if (externalHeader)
      for (const [rowIndex, row] of analysis.rows.entries()) {
        const rowErrors = this.rowErrors(row, analysis);
        if (rowErrors.length) {
          invalidRows++;
          if (validationErrors.length < 50) validationErrors.push({ row: rowIndex + 2, errors: rowErrors });
          continue;
        }
        const key = String(row[externalHeader] ?? "").trim();
        if (!key) continue;
        const prior = existingById.get(key);
        if (!prior) {
          newUnits++;
          continue;
        }
        existingUnits++;
        const values = this.valuesForRow(row, analysis);
        const updateData = this.unitData(values, false);
        const changedFields = this.changedUnitFields(prior, updateData);
        const incomingPlans: Array<Record<string, any>> = [];
        const planChanged = incomingPlans.some((incoming) => {
          const priorPlan = prior.paymentPlans.find((plan) => (plan.durationMonths ?? undefined) === incoming.durationMonths && plan.isActive);
          return !priorPlan || !this.sameValue(priorPlan.totalPrice, incoming.totalPrice) || !this.sameValue(priorPlan.installmentAmount, incoming.installmentAmount) || !this.sameValue(priorPlan.downPaymentAmount ?? priorPlan.downPayment, incoming.downPaymentAmount ?? incoming.downPayment);
        });
        if (changedFields.includes("price")) priceChanges++;
        if (changedFields.includes("status")) availabilityChanges++;
        if (planChanged) paymentPlanChanges++;
        if (changedFields.length || planChanged) {
          updatedUnits++;
          if (changeExamples.length < 50)
            changeExamples.push({
              externalUnitId: key,
              fields: [
                ...changedFields,
                ...(planChanged ? ["paymentPlan"] : []),
              ],
            });
        }
      }
    if (duplicateIdentifiers) {
      await this.prisma.importIssue.deleteMany({
        where: { importId: id, field: "duplicate:externalUnitId" },
      });
      await this.prisma.importIssue.create({
        data: {
          importId: id,
          severity: IssueSeverity.BLOCKING,
          field: "duplicate:externalUnitId",
          message: `${duplicateIdentifiers} duplicate unit identifiers were found. Correct the workbook or choose a stable identity column before confirmation.`,
          inputType: "CONFIRMATION",
          required: true,
        },
      });
    }
    const preview = {
      engineVersion: IMPORT_PREVIEW_ENGINE_VERSION,
      project: analysis.metadata.projectName || item.project?.name,
      developer: analysis.metadata.developerName || item.developer?.name,
      locationId: analysis.metadata.locationId,
      rowsFound: analysis.rows.length,
      valid: identifiers.length,
      rejected: analysis.rows.length - identifiers.length,
      invalidRows,
      validationErrors,
      newUnits,
      existingUnits,
      updatedUnits,
      priceChanges,
      availabilityChanges,
      paymentPlanChanges,
      unchangedRows: existingUnits - updatedUnits,
      duplicateIdentifiers,
      removedUnits: existing.filter(
        (unit) => !uniqueIdentifiers.has(unit.externalUnitId),
      ).length,
      missingUnitPolicy: item.missingUnitPolicy,
      changeExamples,
      blockingIssues: blocking + (duplicateIdentifiers ? 1 : 0),
      paymentPlanCount: 0,
      paymentPlanDurations: [...new Set(Object.values(analysis.paymentPlanMappings ?? {}).filter((plan) => plan.approved).map((plan) => plan.durationMonths))],
      currency: String(analysis.defaultValues.currency ?? ""),
      canConfirm: blocking === 0 && duplicateIdentifiers === 0 && invalidRows === 0,
    };
    await this.prisma.dataImport.update({
      where: { id },
      data: {
        preview: this.json(preview),
        status:
          blocking || duplicateIdentifiers || invalidRows
            ? ImportStatus.NEEDS_INPUT
            : ImportStatus.READY,
      },
    });
    return { ...(await this.get(id)), preview };
  }

  private number(value: unknown) {
    if (value == null || value === "") return undefined;
    if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
    const arabicDigits: Record<string, string> = { "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9", "٫":".", "٬":"" };
    let source = String(value).trim().replace(/[٠-٩٫٬]/g, (character) => arabicDigits[character]);
    const negative = /^\(.*\)$/.test(source);
    source = source.replace(/^\(|\)$/g, "").replace(/(?:EGP|USD|EUR|AED|SAR|GBP|جنيه|ج\.م)/giu, "").replace(/[$€£¥,%\s,]/g, "");
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(source)) return undefined;
    const n = Number(source) * (negative ? -1 : 1);
    return Number.isFinite(n) ? n : undefined;
  }
  private status(value: unknown) {
    const s = String(value ?? "AVAILABLE").toUpperCase();
    return /SOLD|مباع/u.test(s)
      ? UnitStatus.SOLD
      : /RESERV|محجوز/u.test(s)
        ? UnitStatus.RESERVED
        : /UNAV|غير\s*متاح/u.test(s)
          ? UnitStatus.UNAVAILABLE
          : /CONTACT|تواصل/u.test(s) ? UnitStatus.CONTACT_SALES
          : UnitStatus.AVAILABLE;
  }

  private rowErrors(row: Record<string, unknown>, analysis: Analysis) {
    const values = this.valuesForRow(row, analysis);
    const errors: Array<{ field: string; code: string }> = [];
    if (!String(values.externalUnitId ?? "").trim()) errors.push({ field: "externalUnitId", code: "REQUIRED" });
    for (const field of ["bedrooms", "bathrooms", "builtUpArea", "landArea", "gardenArea", "roofArea", "terraceArea", "price", "downPayment", "installmentYears", "installmentAmount", "maintenance"])
      if (values[field] != null && values[field] !== "" && this.number(values[field]) == null) errors.push({ field, code: "INVALID_NUMBER" });
    if (values.deliveryDate != null && values.deliveryDate !== "" && !parseImportDate(values.deliveryDate)) errors.push({ field: "deliveryDate", code: "INVALID_DATE" });
    if (values.deliveryYears != null && values.deliveryYears !== "" && parseDeliveryDurationYears(values.deliveryYears) == null && this.number(values.deliveryYears) == null) errors.push({ field: "deliveryYears", code: "INVALID_DURATION" });
    const currency = String(values.currency ?? analysis.defaultValues.currency ?? "").toUpperCase();
    if (!SUPPORTED_CURRENCIES.includes(currency as any)) errors.push({ field: "currency", code: "INVALID_CURRENCY" });
    for (const [sourceColumn, mapping] of Object.entries(analysis.paymentPlanMappings ?? {})) {
      if (!mapping.approved) errors.push({ field: sourceColumn, code: "PAYMENT_PLAN_NOT_APPROVED" });
      if (row[sourceColumn] != null && row[sourceColumn] !== "" && this.number(row[sourceColumn]) == null) errors.push({ field: sourceColumn, code: "INVALID_PAYMENT_VALUE" });
    }
    return errors;
  }

  private valuesForRow(row: Record<string, unknown>, analysis: Analysis) {
    const values: Record<string, unknown> = { ...analysis.defaultValues };
    for (const [header, field] of Object.entries(analysis.mappings))
      if (row[header] != null && row[header] !== "") {
        const raw = row[header];
        const mapped = analysis.valueMappings[field]?.[this.normalize(String(raw))] ?? raw;
        if (field === "deliveryDate") {
          const date = parseImportDate(mapped);
          const durationYears = date ? undefined : parseDeliveryDurationYears(mapped);
          if (durationYears != null) { values.deliveryYears = durationYears; continue; }
        }
        if (field === "deliveryYears") { values.deliveryYears = parseDeliveryDurationYears(mapped) ?? mapped; continue; }
        values[field] = mapped;
      }
    return values;
  }
  private paymentPlansForRow(
    row: Record<string, unknown>,
    analysis: Analysis,
    rowNumber: number,
    importId?: string,
    fileName?: string,
  ): Array<Record<string, any>> {
    const grouped = new Map<string, Record<string, any>>();
    for (const [sourceColumn, mapping] of Object.entries(analysis.paymentPlanMappings ?? {})) {
      if (!mapping.approved) continue;
      const numeric = this.number(row[sourceColumn]);
      if (numeric == null) continue;
      const currency = mapping.currency || String(analysis.defaultValues.currency || "EGP");
      const key = `${mapping.durationMonths ?? "default"}:${currency}`;
      const plan = grouped.get(key) ?? {
        name: mapping.durationMonths ? `${mapping.durationMonths} months` : "Imported payment plan",
        durationMonths: mapping.durationMonths,
        installmentYears: mapping.durationMonths ? mapping.durationMonths / 12 : undefined,
        currency,
        sourceImportId: importId,
        sourceMetadata: { importId, filename: fileName, sheet: analysis.sheetName, row: rowNumber, sources: [] },
        isActive: true,
      };
      const target: Record<string, string> = { TOTAL_PRICE: "totalPrice", INSTALLMENT_AMOUNT: "installmentAmount", DOWN_PAYMENT_AMOUNT: "downPaymentAmount", DOWN_PAYMENT_PERCENT: "downPaymentPercent", MAINTENANCE_AMOUNT: "maintenanceAmount", MAINTENANCE_PERCENT: "maintenancePercent" };
      plan[target[mapping.valueType]] = numeric;
      if (mapping.valueType === "DOWN_PAYMENT_AMOUNT") plan.downPayment = numeric;
      plan.sourceMetadata.sources.push({ sourceColumn, originalValue: row[sourceColumn], mappedCanonicalField: mapping.valueType, adminMappingDecision: "APPROVED", sourceDurationText: mapping.sourceDurationText, parsedDurationMonths: mapping.durationMonths });
      grouped.set(key, plan);
    }
    const values = this.valuesForRow(row, analysis);
    if (this.number(values.downPayment) != null || this.number(values.installmentYears) != null || this.number(values.installmentAmount) != null) {
      const months = this.number(values.installmentYears) != null ? Math.round(this.number(values.installmentYears)! * 12) : undefined;
      const key = `${months ?? "default"}:${String(values.currency || analysis.defaultValues.currency || "EGP")}`;
      const prior = grouped.get(key) ?? {};
      grouped.set(key, { ...prior, name: months ? `${months} months` : "Imported payment plan", durationMonths: months, installmentYears: this.number(values.installmentYears), downPayment: this.number(values.downPayment), downPaymentAmount: this.number(values.downPayment), installmentAmount: this.number(values.installmentAmount), currency: String(values.currency || analysis.defaultValues.currency || "EGP"), sourceImportId: importId, sourceMetadata: prior.sourceMetadata ?? this.json({ importId, filename: fileName, sheet: analysis.sheetName, row: rowNumber, mappedCanonicalField: "paymentPlan" }), isActive: true });
    }
    return [...grouped.values()].map((plan) => ({ ...plan, sourceMetadata: this.json(plan.sourceMetadata) }));
  }
  private unitData(
    values: Record<string, unknown>,
    contactSales: boolean,
  ): Prisma.UnitUncheckedUpdateInput {
    const text = (field: string) =>
      values[field] == null || values[field] === ""
        ? undefined
        : String(values[field]);
    const deliveryDate = parseImportDate(values.deliveryDate);
    return {
      phaseId: text("phaseId"),
      phase: text("phase"),
      cluster: text("cluster"),
      building: text("building"),
      floor: text("floor"),
      unitType: values.unitType == null ? undefined : normalizeUnitType(values.unitType),
      unitSubType: text("unitSubType"),
      bedrooms: this.number(values.bedrooms),
      bathrooms: this.number(values.bathrooms),
      builtUpArea: this.number(values.builtUpArea),
      landArea: this.number(values.landArea),
      gardenArea: this.number(values.gardenArea),
      roofArea: this.number(values.roofArea),
      terraceArea: this.number(values.terraceArea),
      price: this.number(values.price),
      currency: text("currency"),
      isResale: values.isResale === true || String(values.isResale ?? "").toLowerCase() === "true",
      status: contactSales
        ? UnitStatus.CONTACT_SALES
        : values.status != null
          ? this.status(values.status)
          : undefined,
      deliveryDate,
      deliveryYears: parseDeliveryDurationYears(values.deliveryYears) ?? this.number(values.deliveryYears),
      finishingType:
        values.finishingType == null
          ? undefined
          : normalizeFinishing(values.finishingType),
      downPayment: this.number(values.downPayment),
      installmentYears: this.number(values.installmentYears),
      installmentAmount: this.number(values.installmentAmount),
      maintenance: this.number(values.maintenance),
      clubFees: this.number(values.clubFees),
      discount: this.number(values.discount),
      offerText: text("offerText"),
      availabilityUpdatedAt:
        values.status != null || contactSales ? new Date() : undefined,
    };
  }
  private comparable(unit: Record<string, any>) {
    const copy = { ...unit };
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.paymentPlans;
    delete copy.offers;
    delete copy.priceHistory;
    delete copy.importChanges;
    delete copy.media;
    return this.json(copy);
  }
  private sameValue(left: unknown, right: unknown) {
    if (left == null && right == null) return true;
    const normalize = (value: unknown) =>
      value instanceof Date
        ? value.toISOString()
        : typeof value === "object" && value && "toString" in value
          ? String(value)
          : value;
    return String(normalize(left) ?? "") === String(normalize(right) ?? "");
  }
  private changedUnitFields(
    existing: Record<string, any>,
    data: Prisma.UnitUncheckedUpdateInput,
  ) {
    return Object.entries(data)
      .filter(
        ([field, value]) =>
          field !== "availabilityUpdatedAt" && field !== "sourceMetadata" &&
          value !== undefined &&
          !this.sameValue(existing[field], value),
      )
      .map(([field]) => field);
  }

  private confirmDatabaseException(importId: string, error: unknown) {
    const code = String((error as any)?.code ?? "");
    const message = String((error as any)?.message ?? "");
    const meta = (error as any)?.meta;
    this.logger.error(`ImportTransactionFailure importId=${importId} prismaCode=${code || "UNKNOWN"} message=${message} meta=${meta ? JSON.stringify(meta) : "none"}`);

    if (code === "P2021" || /ProjectPhaseAlias|does not exist|table .* not exist/i.test(message)) {
      return new ImportHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        "IMPORT_SCHEMA_OUT_OF_DATE",
        "قاعدة البيانات لم تُحدَّث بآخر migrations الخاصة بالاستيراد. شغّل npm run db:migrate:deploy على خدمة API ثم أعد المحاولة.",
        "database-schema",
        importId,
      );
    }

    if (code === "P2002") {
      return new ImportHttpException(
        HttpStatus.CONFLICT,
        "IMPORT_DUPLICATE_UNIT",
        "يوجد كود وحدة مكرر يتعارض مع سجل موجود. راجع هوية الوحدة أو بيانات الملف ثم أعد إنشاء المعاينة.",
        "database-constraint",
        importId,
      );
    }

    if (code === "P2003" || code === "P2004" || /must belong|must own|same project|foreign key|constraint/i.test(message)) {
      return new ImportHttpException(
        HttpStatus.CONFLICT,
        "IMPORT_RELATION_CONFLICT",
        "تعذر الحفظ لأن علاقة المطور أو المشروع أو المرحلة غير متطابقة. أعد اختيار سياق الجدول والمرحلة ثم أنشئ معاينة جديدة.",
        "database-constraint",
        importId,
      );
    }

    return new ImportHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      "IMPORT_CONFIRM_FAILED",
      "فشل اعتماد الاستيراد داخل المعاملة. لم يتم حفظ بيانات جزئية. راجع سجل API باستخدام Request ID ثم أعد المحاولة.",
      "database-transaction",
      importId,
    );
  }

  private async confirmSheets(item: any) {
    const selected = item.sheets.filter((sheet: any) => sheet.action === "IMPORT");
    const stale = selected.some((sheet: any) => sheet.previewMappingVersion !== sheet.mappingVersion);
    if (!item.workflow.canConfirm || stale)
      throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_PREVIEW_REQUIRED", "أنشئ معاينة حديثة بعد آخر تعديل قبل تأكيد الاستيراد.", "validation", item.id);
    const analysis = item.analysis as Analysis;
    if (!analysis.fileKey) throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_VALIDATION_ISSUES", "Source workbook is unavailable.", "validation", item.id);
    const workbook = readImportWorkbook(await this.storage.get(analysis.fileKey), analysis.workbookAnalysis.workbookName);
    await this.prisma.dataImport.update({ where: { id: item.id }, data: { status: ImportStatus.IMPORTING } });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        let created = 0, updated = 0, rejected = 0, skipped = 0;
        for (const sheet of selected) {
          let sheetCreated = 0, sheetUpdated = 0;
          const rows = recordsForTable(workbook, this.persistedTable(sheet));
          const [phases, phaseAliases] = await Promise.all([
            tx.projectPhase.findMany({ where: { projectId: sheet.projectId! }, select: { id: true, code: true, name: true, nameAr: true, nameEn: true } }),
            tx.projectPhaseAlias.findMany({ where: { projectId: sheet.projectId! }, select: { normalizedValue: true, phaseId: true } }),
          ]);
          for (const [index, row] of rows.entries()) {
            const { values, metadata } = this.valuesForSheet(row, sheet);
            const resolvedPhase = this.resolveStructuredPhase(values, phases, sheet.phaseId, phaseAliases);
            if (resolvedPhase.phaseId) values.phaseId = resolvedPhase.phaseId;
            const externalUnitId = String(values.externalUnitId ?? "").trim();
            if (!externalUnitId || resolvedPhase.unmatched || !values.phaseId) { rejected++; continue; }
            const existing = await tx.unit.findUnique({
              where: { developerId_projectId_externalUnitId: { developerId: sheet.developerId!, projectId: sheet.projectId!, externalUnitId } },
              include: { paymentPlans: true, offers: true },
            });
            const updateData = this.unitData(values, false);
            updateData.sourceMetadata = this.json({
              ...metadata,
              _provenance: {
                importId: item.id,
                importSheetId: sheet.id,
                filename: item.fileName,
                sheet: sheet.sheetName,
                row: (sheet.headerRow ?? 1) + index + 1,
                mappingVersion: sheet.mappingVersion,
                mappings: sheet.mappings,
              },
            });
            if (existing && !this.changedUnitFields(existing, updateData).length) { skipped++; continue; }
            const before = existing ? this.json({ unit: this.comparable(existing), paymentPlans: existing.paymentPlans, offers: existing.offers }) : undefined;
            const unit = existing
              ? await tx.unit.update({ where: { id: existing.id }, data: updateData })
              : await tx.unit.create({ data: { ...updateData, externalUnitId, developerId: sheet.developerId!, projectId: sheet.projectId!, sourceImportId: item.id } as Prisma.UnitUncheckedCreateInput });
            existing ? (updated++, sheetUpdated++) : (created++, sheetCreated++);
            if (updateData.price != null && (!existing?.price || existing.price.toString() !== String(updateData.price)))
              await tx.unitPriceHistory.create({ data: { unitId: unit.id, price: updateData.price as any, currency: String(updateData.currency || existing?.currency || sheet.defaultCurrency || "EGP"), importId: item.id } });
            const after = await tx.unit.findUniqueOrThrow({ where: { id: unit.id }, include: { paymentPlans: true, offers: true } });
            await tx.importUnitChange.create({ data: { importId: item.id, importSheetId: sheet.id, unitId: unit.id, operation: existing ? ImportUnitOperation.UPDATED : ImportUnitOperation.CREATED, beforeData: before, afterData: this.json({ unit: this.comparable(after), paymentPlans: after.paymentPlans, offers: after.offers }) } });
          }
          await tx.importSheet.update({ where: { id: sheet.id }, data: { rowsCreated: sheetCreated, rowsUpdated: sheetUpdated, importedAt: new Date() } });
          for (const [sourceColumn, canonicalField] of Object.entries(sheet.mappings as Record<string, string>)) {
            if (!INVENTORY_CANONICAL.includes(canonicalField)) continue;
            const developer = await tx.developer.findUnique({ where: { id: sheet.developerId! }, select: { slug: true } });
            const developerSlug = developer?.slug ?? `developer:${sheet.developerId}`;
            await tx.importMapping.upsert({
              where: { developerSlug_normalizedColumn: { developerSlug, normalizedColumn: this.normalize(sourceColumn) } },
              create: { developerSlug, sourceColumn, normalizedColumn: this.normalize(sourceColumn), canonicalField, approved: true, confidence: 1 },
              update: { canonicalField, approved: true, confidence: 1 },
            });
          }
        }
        await tx.dataImport.update({ where: { id: item.id }, data: { status: ImportStatus.COMPLETED, rowsCreated: created, rowsUpdated: updated, rowsRejected: rejected, rowsSkipped: skipped, rowsFailed: rejected, completedAt: new Date() } });
        return { created, updated, rejected, skipped, selectedSheets: selected.length, paymentPlansCreated: 0 };
      }, { timeout: 120_000 });
      this.cache?.invalidateCustomerData();
      return { import: await this.get(item.id), result };
    } catch (error) {
      try {
        await this.prisma.dataImport.update({ where: { id: item.id }, data: { status: ImportStatus.READY } });
      } catch (statusError) {
        this.logger.error(`ImportStatusRecoveryFailure importId=${item.id} error=${statusError instanceof Error ? statusError.message : String(statusError)}`);
      }
      if (error instanceof ImportHttpException) throw error;
      throw this.confirmDatabaseException(item.id, error);
    }
  }

  async confirm(id: string) {
    const item = await this.get(id);
    if (item.sheets.length) return this.confirmSheets(item);
    const unresolved = item.issues.filter(
      (i: any) => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt,
    );
    if (unresolved.length)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_VALIDATION_ISSUES",
        "Resolve all blocking import questions before confirmation.",
        "validation",
        id,
      );
    const preview = item.preview as Record<string, unknown> | null;
    if (!preview || preview.canConfirm !== true)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_PREVIEW_REQUIRED",
        "Generate a valid preview and resolve duplicate unit identifiers before confirmation.",
        "validation",
        id,
      );
    const analysis = item.analysis as unknown as Analysis;
    await this.prisma.dataImport.update({
      where: { id },
      data: { status: ImportStatus.IMPORTING },
    });
    try {
      const result = await this.prisma.$transaction(
        async (tx) => {
          const developerId = item.developerId || analysis.metadata.developerId;
          const projectId = item.projectId || analysis.metadata.projectId;
          if (!developerId || !projectId || !analysis.metadata.locationId)
            throw new ImportHttpException(HttpStatus.UNPROCESSABLE_ENTITY, "IMPORT_VALIDATION_ISSUES", "اختر المشروع والمطور والمنطقة قبل التأكيد.", "normalization", id);
          let created = 0,
            updated = 0,
            rejected = 0,
            skipped = 0;
          const importedIdentifiers = new Set<string>();
          for (const [rowIndex, row] of analysis.rows.entries()) {
            const validationErrors = this.rowErrors(row, analysis);
            if (validationErrors.length)
              throw new ImportHttpException(
                HttpStatus.UNPROCESSABLE_ENTITY,
                "IMPORT_ROW_VALIDATION_FAILED",
                `تعذر اعتماد الصف ${rowIndex + 2}. راجع القيم المحددة.`,
                "normalization",
                id,
              );
            const values = this.valuesForRow(row, analysis);
            if (
              Object.entries(analysis.rowPolicies).some(
                ([field, policy]) =>
                  policy === "EXCLUDE_ROWS" &&
                  (values[field] == null || values[field] === ""),
              )
            ) {
              rejected++;
              continue;
            }
            const externalUnitId = String(values.externalUnitId ?? "").trim();
            if (!externalUnitId) {
              rejected++;
              continue;
            }
            importedIdentifiers.add(externalUnitId);
            const existing = await tx.unit.findUnique({
              where: {
                developerId_projectId_externalUnitId: {
                  developerId,
                  projectId,
                  externalUnitId,
                },
              },
              include: { paymentPlans: true, offers: true },
            });
            const contactSales = Object.entries(analysis.rowPolicies).some(
              ([field, policy]) =>
                policy === "CONTACT_SALES" &&
                (values[field] == null || values[field] === ""),
            );
            const updateData = this.unitData(values, contactSales);
            const sourceMetadata: Record<string, unknown> = Object.fromEntries(
              (analysis.metadataColumns ?? []).filter((header) => row[header] != null && row[header] !== "").map((header) => [header, row[header]]),
            );
            for (const [sourceColumn, mappedCanonicalField] of Object.entries(analysis.mappings)) {
              const raw = row[sourceColumn];
              if (raw == null || raw === "") continue;
              if (METADATA_CANONICAL.has(mappedCanonicalField)) sourceMetadata[mappedCanonicalField] = raw;
              else if (isCustomMetadataField(mappedCanonicalField)) sourceMetadata[customMetadataLabel(mappedCanonicalField)!] = raw;
            }
            sourceMetadata._provenance = { importId: id, filename: item.fileName, sheet: analysis.sheetName, row: rowIndex + 2, values: Object.entries(analysis.mappings).filter(([header]) => row[header] != null && row[header] !== "").map(([sourceColumn, mappedCanonicalField]) => ({ sourceColumn, originalValue: row[sourceColumn], mappedCanonicalField, adminMappingDecision: analysis.mappingSources[sourceColumn] ?? "KNOWN_RULE", aiSuggestion: (analysis.aiSuggestions as any[]).find((suggestion: any) => suggestion?.sourceColumn === sourceColumn) ?? null })) };
            updateData.sourceMetadata = this.json(sourceMetadata);
            const createData = {
              ...updateData,
              externalUnitId,
              developerId,
              projectId,
              sourceImportId: id,
            } as Prisma.UnitUncheckedCreateInput;
            const activePlan = existing?.paymentPlans.find(
              (plan) => plan.isActive,
            );
            const incomingPlans: Array<Record<string, any>> = [];
            const activeOffer = existing?.offers.find(
              (offer) => offer.isActive,
            );
            const planChanged = incomingPlans.some((incoming) => {
              const priorPlan = existing?.paymentPlans.find(
                (plan) =>
                  plan.isActive &&
                  (plan.durationMonths ?? undefined) === incoming.durationMonths,
              );
              return (
                !priorPlan ||
                !this.sameValue(priorPlan.totalPrice, incoming.totalPrice) ||
                !this.sameValue(priorPlan.installmentAmount, incoming.installmentAmount) ||
                !this.sameValue(priorPlan.downPaymentAmount ?? priorPlan.downPayment, incoming.downPaymentAmount ?? incoming.downPayment)
              );
            });
            const offerChanged =
              updateData.offerText || updateData.discount != null
                ? !activeOffer ||
                  (updateData.offerText != null &&
                    !this.sameValue(
                      activeOffer.description,
                      updateData.offerText,
                    )) ||
                  (updateData.discount != null &&
                    !this.sameValue(
                      activeOffer.discountAmount,
                      updateData.discount,
                    ))
                : false;
            if (
              existing &&
              !this.changedUnitFields(existing, updateData).length &&
              !planChanged &&
              !offerChanged
            ) {
              skipped++;
              continue;
            }
            const before = existing
              ? this.json({
                  unit: this.comparable(existing),
                  paymentPlans: existing.paymentPlans,
                  offers: existing.offers,
                })
              : undefined;
            const unit = existing
              ? await tx.unit.update({
                  where: { id: existing.id },
                  data: updateData,
                })
              : await tx.unit.create({ data: createData });
            existing ? updated++ : created++;
            if (
              planChanged || (!existing && incomingPlans.length)
            ) {
              for (const incoming of incomingPlans) {
                await tx.paymentPlan.updateMany({
                  where: { unitId: unit.id, durationMonths: incoming.durationMonths == null ? null : Number(incoming.durationMonths), isActive: true },
                  data: { isActive: false },
                });
                await tx.paymentPlan.create({
                  data: { ...incoming, unitId: unit.id } as Prisma.PaymentPlanUncheckedCreateInput,
                });
              }
            }
            if (
              offerChanged ||
              (!existing &&
                (updateData.offerText || updateData.discount != null))
            ) {
              await tx.offer.updateMany({
                where: { unitId: unit.id, isActive: true },
                data: { isActive: false },
              });
              await tx.offer.create({
                data: {
                  unitId: unit.id,
                  title: String(updateData.offerText || "Imported offer"),
                  description: updateData.offerText
                    ? String(updateData.offerText)
                    : undefined,
                  discountAmount: updateData.discount as any,
                  isActive: true,
                },
              });
            }
            if (
              updateData.price != null &&
              (!existing?.price ||
                existing.price.toString() !== String(updateData.price))
            )
              await tx.unitPriceHistory.create({
                data: {
                  unitId: unit.id,
                  price: updateData.price as any,
                  currency: String(
                    updateData.currency || existing?.currency || "EGP",
                  ),
                  importId: id,
                },
              });
            const afterUnit = await tx.unit.findUniqueOrThrow({
              where: { id: unit.id },
              include: { paymentPlans: true, offers: true },
            });
            await tx.importUnitChange.create({
              data: {
                importId: id,
                unitId: unit.id,
                operation: existing
                  ? ImportUnitOperation.UPDATED
                  : ImportUnitOperation.CREATED,
                beforeData: before,
                afterData: this.json({
                  unit: this.comparable(afterUnit),
                  paymentPlans: afterUnit.paymentPlans,
                  offers: afterUnit.offers,
                }),
              },
            });
          }
          if (item.missingUnitPolicy !== "LEAVE_UNCHANGED") {
            const missing = await tx.unit.findMany({
              where: {
                developerId,
                projectId,
                externalUnitId: { notIn: [...importedIdentifiers] },
              },
              include: { paymentPlans: true, offers: true },
            });
            for (const unit of missing) {
              const before = this.json({
                unit: this.comparable(unit),
                paymentPlans: unit.paymentPlans,
                offers: unit.offers,
              });
              const changed = await tx.unit.update({
                where: { id: unit.id },
                data:
                  item.missingUnitPolicy === "ARCHIVE"
                    ? { archivedAt: new Date() }
                    : {
                        status: UnitStatus.UNAVAILABLE,
                        availabilityUpdatedAt: new Date(),
                      },
              });
              await tx.importUnitChange.create({
                data: {
                  importId: id,
                  unitId: unit.id,
                  operation: ImportUnitOperation.UPDATED,
                  beforeData: before,
                  afterData: this.json({
                    unit: this.comparable(changed),
                    paymentPlans: unit.paymentPlans,
                    offers: unit.offers,
                  }),
                },
              });
              updated++;
            }
          }
          for (const [header, canonicalField] of Object.entries(
            analysis.mappings,
          )) {
            const developerSlug =
              analysis.metadata.developerSlug || "__global__";
            await tx.importMapping.upsert({
              where: {
                developerSlug_normalizedColumn: {
                  developerSlug,
                  normalizedColumn: this.normalize(header),
                },
              },
              create: {
                developerSlug,
                sourceColumn: header,
                normalizedColumn: this.normalize(header),
                canonicalField,
                approved: true,
                confidence:
                  analysis.mappingSources[header] === "AI_HIGH_CONFIDENCE"
                    ? 0.95
                    : 1,
              },
              update: { canonicalField, approved: true },
            });
          }
          for (const [header, plan] of Object.entries(analysis.paymentPlanMappings ?? {})) {
            if (!plan.approved) continue;
            const developerSlug = analysis.metadata.developerSlug || `developer:${developerId}`;
            const canonicalField = `paymentPlan:${plan.durationMonths ?? 0}:${plan.valueType}`;
            await tx.importMapping.upsert({
              where: { developerSlug_normalizedColumn: { developerSlug, normalizedColumn: this.normalize(header) } },
              create: { developerSlug, sourceColumn: header, normalizedColumn: this.normalize(header), canonicalField, approved: true, confidence: 1 },
              update: { canonicalField, approved: true, confidence: 1 },
            });
          }
          for (const [canonicalField, mappings] of Object.entries(
            analysis.valueMappings,
          ))
            for (const [normalizedValue, targetValue] of Object.entries(
              mappings,
            )) {
              const developerSlug =
                analysis.metadata.developerSlug || "__global__";
              await tx.importValueMapping.upsert({
                where: {
                  developerSlug_canonicalField_normalizedValue: {
                    developerSlug,
                    canonicalField,
                    normalizedValue,
                  },
                },
                create: {
                  developerSlug,
                  canonicalField,
                  sourceValue: normalizedValue,
                  normalizedValue,
                  targetValue,
                  approved: true,
                },
                update: { targetValue, approved: true },
              });
            }
          await tx.dataImport.update({
            where: { id },
            data: {
              developerId,
              projectId,
              status: ImportStatus.COMPLETED,
              rowsCreated: created,
              rowsUpdated: updated,
            rowsRejected: rejected,
            rowsSkipped: skipped,
            rowsFailed: rejected,
              completedAt: new Date(),
            },
          });
          return {
            developerId,
            projectId,
            created,
            updated,
            rejected,
            skipped,
          };
        },
        { timeout: 120_000 },
      );
      this.cache?.invalidateCustomerData();
      return { import: await this.get(id), result };
    } catch (error) {
      if (error instanceof ImportHttpException) {
        await this.prisma.dataImport.update({
          where: { id },
          data: { status: ImportStatus.NEEDS_INPUT },
        });
        throw error;
      }
      await this.markFailed(
        id,
        "IMPORT_CONFIRM_FAILED",
        "database-transaction",
      );
      throw new ImportHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        "IMPORT_CONFIRM_FAILED",
        "The transactional import failed; no partial inventory was committed.",
        "database-transaction",
        id,
      );
    }
  }

  private restoreUnitData(raw: Record<string, any>) {
    const data = { ...raw };
    for (const field of ["deliveryDate", "availabilityUpdatedAt", "archivedAt"])
      if (data[field]) data[field] = new Date(data[field]);
    return data as Prisma.UnitUncheckedUpdateInput;
  }

  async removeBatch(
    id: string,
    mode: "DELETE_UNFINISHED" | "DELETE_SOURCE_RECORD" | "DELETE_EXCLUSIVE_RECORDS" | "ROLLBACK_SAFE",
  ) {
    const item = await this.get(id);
    if (mode === "DELETE_UNFINISHED") {
      if (item.status === ImportStatus.COMPLETED || item.status === ImportStatus.ROLLED_BACK || item.unitChanges.length)
        throw new ImportHttpException(HttpStatus.CONFLICT, "IMPORT_CONFIRMED_DELETE_BLOCKED", "Confirmed inventory cannot be deleted as an unfinished import. Use the reviewed rollback workflow.", "cleanup", id);
      const [sourceUnits, sourcePlans] = await this.prisma.$transaction([
        this.prisma.unit.count({ where: { sourceImportId: id } }),
        this.prisma.paymentPlan.count({ where: { sourceImportId: id } }),
      ]);
      if (sourceUnits || sourcePlans)
        throw new ImportHttpException(HttpStatus.CONFLICT, "IMPORT_HAS_INVENTORY_PROVENANCE", "This import owns inventory records and requires safe rollback review.", "cleanup", id);
      const analysis = (item.analysis ?? {}) as unknown as Analysis;
      let sourceObjectDeleted = false;
      let sourceObjectExclusive = false;
      if (item.fileUrl && analysis.fileKey) {
        const [imports, media, documents] = await this.prisma.$transaction([
          this.prisma.dataImport.count({ where: { fileUrl: item.fileUrl, id: { not: id } } }),
          this.prisma.media.count({ where: { url: item.fileUrl } }),
          this.prisma.document.count({ where: { url: item.fileUrl } }),
        ]);
        sourceObjectExclusive = imports + media + documents === 0;
      }
      await this.prisma.dataImport.delete({ where: { id } });
      let storageCleanupFailed = false;
      if (sourceObjectExclusive && analysis.fileKey) {
        try { await this.storage.delete(analysis.fileKey); sourceObjectDeleted = true; }
        catch (error) { storageCleanupFailed = true; this.logger.error(`ImportCleanupFailure importId=${id} stage=storage-delete code=IMPORT_STORAGE_FAILED`); }
      }
      return { id, mode, deleted: true, sourceObjectDeleted, sourceObjectRetained: Boolean(item.fileUrl && !sourceObjectDeleted), storageCleanupFailed, affected: 0, conflicts: 0 };
    }
    if (mode === "DELETE_SOURCE_RECORD") {
      if (item.unitChanges.length)
        throw new ImportHttpException(
          HttpStatus.CONFLICT,
          "IMPORT_HAS_INVENTORY_PROVENANCE",
          "This batch changed inventory. Use safe rollback or delete exclusively created records.",
          "rollback",
          id,
        );
      await this.prisma.dataImport.update({ where: { id }, data: { status: ImportStatus.CANCELLED, cancelledAt: new Date(), warnings: this.json({ sourceRecordCancelled: true, sourceObjectRetained: true }) } });
      return { id, deletedSourceRecord: false, cancelled: true, sourceObjectRetained: true, affected: 0, conflicts: 0 };
    }
    if (
      item.status !== ImportStatus.COMPLETED &&
      item.status !== ImportStatus.FAILED &&
      item.status !== ImportStatus.ROLLED_BACK
    )
      throw new ImportHttpException(
        HttpStatus.CONFLICT,
        "IMPORT_NOT_ROLLBACKABLE",
        "Only completed or failed applied batches can be rolled back.",
        "rollback",
        id,
      );
    const result = await this.prisma.$transaction(
      async (tx) => {
        const changes = await tx.importUnitChange.findMany({
          where: { importId: id, revertedAt: null },
          orderBy: { appliedAt: "desc" },
        });
        let affected = 0,
          conflicts = 0;
        for (const change of changes) {
          if (
            mode === "DELETE_EXCLUSIVE_RECORDS" &&
            change.operation !== ImportUnitOperation.CREATED
          )
            continue;
          if (!change.unitId) {
            conflicts++;
            await tx.importUnitChange.update({
              where: { id: change.id },
              data: { conflictReason: "Unit reference is no longer available" },
            });
            continue;
          }
          const laterChange = await tx.importUnitChange.findFirst({
            where: {
              unitId: change.unitId,
              importId: { not: id },
              appliedAt: { gt: change.appliedAt },
              revertedAt: null,
            },
          });
          const current = await tx.unit.findUnique({
            where: { id: change.unitId },
            include: { paymentPlans: true, offers: true, media: true },
          });
          const expected = change.afterData as Record<string, any>;
          const currentSnapshot = current
            ? this.json({
                unit: this.comparable(current),
                paymentPlans: current.paymentPlans,
                offers: current.offers,
              })
            : null;
        const conflictReason = rollbackConflict({
          operation: change.operation,
          unitExists: Boolean(current),
          currentMatchesAppliedSnapshot: isDeepStrictEqual(
            currentSnapshot,
            expected,
          ),
          laterImportExists: Boolean(laterChange),
          hasAttachedMedia: Boolean(current?.media.length),
        });
        if (conflictReason) {
          conflicts++;
          await tx.importUnitChange.update({
            where: { id: change.id },
            data: { conflictReason },
          });
          continue;
        }
          if (change.operation === ImportUnitOperation.CREATED)
            await tx.unit.delete({ where: { id: change.unitId } });
          else {
            const before = change.beforeData as Record<string, any>;
            await tx.paymentPlan.deleteMany({
              where: { unitId: change.unitId },
            });
            await tx.offer.deleteMany({ where: { unitId: change.unitId } });
            await tx.unit.update({
              where: { id: change.unitId },
              data: this.restoreUnitData(before.unit),
            });
            for (const plan of before.paymentPlans ?? []) {
              const { id: _id, unitId: _unitId, ...data } = plan;
              await tx.paymentPlan.create({
                data: { ...data, unitId: change.unitId },
              });
            }
            for (const offer of before.offers ?? []) {
              const { id: _id, unitId: _unitId, ...data } = offer;
              if (data.startsAt) data.startsAt = new Date(data.startsAt);
              if (data.endsAt) data.endsAt = new Date(data.endsAt);
              await tx.offer.create({
                data: { ...data, unitId: change.unitId },
              });
            }
          }
          await tx.importUnitChange.update({
            where: { id: change.id },
            data: { revertedAt: new Date(), conflictReason: null },
          });
          affected++;
        }
        await tx.dataImport.update({
          where: { id },
          data: {
            status: ImportStatus.ROLLED_BACK,
            rolledBackAt: new Date(),
            warnings: this.json({ rollbackMode: mode, affected, conflicts }),
          },
        });
        return { affected, conflicts };
      },
      { timeout: 120_000 },
    );
    return { id, mode, ...result, import: await this.get(id) };
  }
}
