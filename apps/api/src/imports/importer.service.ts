import {
  BadRequestException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
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
import {
  AVAILABILITY_TYPES,
  CANONICAL_FIELDS,
  CANONICAL_VALUES,
  FINISHING_TYPES,
  parseImportDate,
  parsePaymentPlanComponentHeader,
  SUPPORTED_CURRENCIES,
  UNIT_TYPES,
  normalizeFinishing,
  normalizeUnitType,
  PaymentPlanValueType,
} from "./import-contract";

const CANONICAL: string[] = [...CANONICAL_VALUES];
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
  headers: string[];
  rows: Record<string, unknown>[];
  mappings: Record<string, string>;
  paymentPlanMappings: Record<string, { durationMonths?: number; valueType: "TOTAL_PRICE" | "INSTALLMENT_AMOUNT" | "DOWN_PAYMENT_AMOUNT" | "DOWN_PAYMENT_PERCENT" | "MAINTENANCE_AMOUNT" | "MAINTENANCE_PERCENT"; currency?: string; sourceDurationText: string; approved: boolean }>;
  mappingSources: Record<string, string>;
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
  fileKey?: string;
};
type ImportContext = { requestId?: string; adminUserId?: string };

@Injectable()
export class ImporterService {
  private readonly logger = new Logger(ImporterService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @Inject("AI_PROVIDER") private readonly ai: AIProvider,
  ) {}
  private normalize(v: string) {
    return v.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }
  private json<T>(value: T): any {
    return JSON.parse(JSON.stringify(value));
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
    const sheetName =
      workbook.SheetNames.find(
        (name) =>
          XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 })
            .length > 1,
      ) ?? workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
      workbook.Sheets[sheetName],
      { defval: null, raw: true },
    );
    if (!rows.length)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_NO_USABLE_SHEETS",
        "The workbook contains no usable data rows.",
        "parser",
      );
    if (rows.length > 10_000)
      throw new ImportHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "IMPORT_ROW_LIMIT_EXCEEDED",
        "Imports are limited to 10,000 rows per file.",
        "parser",
      );
    const headers = Object.keys(rows[0]);
    const mappings: Record<string, string> = {};
    const paymentPlanMappings: Analysis["paymentPlanMappings"] = {};
    const mappingSources: Record<string, string> = {};
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
      const field = prior?.canonicalField ?? KNOWN[normalized];
      if (field?.startsWith("paymentPlan:")) {
        const [, duration, valueType = "TOTAL_PRICE"] = field.split(":");
        paymentPlanMappings[header] = { durationMonths: Number(duration) || undefined, valueType: valueType as PaymentPlanValueType, sourceDurationText: header, approved: true };
      } else if (field) {
        mappings[header] = field;
        mappingSources[header] = prior ? "ADMIN_APPROVED_MEMORY" : "KNOWN_RULE";
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
      headers,
      rows: this.json(rows),
      mappings,
      paymentPlanMappings,
      mappingSources,
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

      let aiIssue = false;
      if (unknown.length) {
        try {
          const suggestions = await this.ai.mapColumns(
            unknown,
            rows.slice(0, 5).map((row) => unknown.map((h) => row[h])),
            CANONICAL,
          );
          analysis.aiSuggestions = suggestions;
          analysis.aiMapping = { status: "COMPLETED" };
          for (const suggestion of suggestions)
            if (
              suggestion.confidence >= 0.95 &&
              CANONICAL.includes(suggestion.canonicalField) &&
              !CRITICAL_MAPPINGS.has(suggestion.canonicalField)
            ) {
              mappings[suggestion.sourceColumn] = suggestion.canonicalField;
              mappingSources[suggestion.sourceColumn] = "AI_SUGGESTION";
            }
          analysis.unknownColumns = headers.filter(
            (header) => !mappings[header],
          );
        } catch (error) {
          const details = importErrorDetails(error);
          analysis.aiMapping = {
            status: "UNAVAILABLE",
            code: String(details.category ?? details.code ?? "AI_UNAVAILABLE"),
          };
          aiIssue = true;
          this.logger.warn(
            `ImportAIMappingUnavailable requestId=${context.requestId ?? "unknown"} adminUserId=${context.adminUserId ?? "unknown"} importId=${dataImport.id} filename=${JSON.stringify(safeFileName)} stage=ai-mapping code=${analysis.aiMapping.code} upstreamStatus=${details.upstreamStatus ?? "none"}`,
          );
        }
      }
      await this.prisma.$transaction(async (tx) => {
        await tx.dataImport.update({
          where: { id: dataImport.id },
          data: {
            status: ImportStatus.NEEDS_INPUT,
            analysis: this.json(analysis),
            mappingConfig: this.json({ mappings, mappingSources }),
          },
        });
        await this.createIssues(dataImport.id, analysis, tx, aiIssue);
      });
      return this.get(dataImport.id);
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
    if (!mapped.has("externalUnitId"))
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "mapping:externalUnitId",
        message: "لم أتمكن من تحديد كود الوحدة. اختر العمود الذي يميز كل وحدة.",
        inputType: "CANONICAL_FIELD_SELECT",
        options: this.json({ canonicalField: "externalUnitId", sourceHeaders: analysis.headers }),
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
        options: this.json({ allowCreate: true }),
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
      if (!CRITICAL_MAPPINGS.has(canonical) || source === "ADMIN_APPROVED_MEMORY" || source === "ADMIN_APPROVED") continue;
      const field = CANONICAL_FIELDS.find((option) => option.value === canonical);
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: `column:${column}`,
        message: `راجع معنى العمود «${column}». النظام يقترح «${field?.labelAr ?? canonical}» ويحتاج تأكيدك أول مرة.`,
        inputType: "CANONICAL_FIELD_SELECT",
        options: this.json({ sourceColumn: column, fields: CANONICAL_FIELDS, suggestedValue: canonical, mappingSource: source, requiresConfirmation: true }),
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
        options: this.json({ sourceColumn: column, fields: CANONICAL_FIELDS, actions: ["METADATA", "IGNORE"] }),
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

  async get(id: string) {
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
      },
    });
    if (!item) throw new NotFoundException("Import not found");
    return item;
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
    if (type in staticOptions) return { items: staticOptions[type], total: (staticOptions[type] as readonly unknown[]).length, page: 1, pageSize: 100 };
    throw new BadRequestException("نوع الخيارات غير مدعوم.");
  }

  async resolve(id: string, field: string, value: unknown) {
    const item = await this.get(id);
    const analysis = item.analysis as unknown as Analysis;
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
      if (!analysis.headers.includes(header) || (durationMonths != null && (!Number.isInteger(durationMonths) || durationMonths < 18 || durationMonths > 180)))
        throw new BadRequestException("اختر مدة سداد صحيحة بين 18 و180 شهراً.");
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
    return this.preview(id);
  }

  async preview(id: string) {
    const item = await this.get(id);
    const analysis = item.analysis as unknown as Analysis;
    const blocking = item.issues.filter(
      (i) => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt,
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
        const incomingPlans = this.paymentPlansForRow(row, analysis, rowIndex + 2);
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
      paymentPlanCount: analysis.rows.reduce((total, row, index) => total + this.paymentPlansForRow(row, analysis, index + 2).length, 0),
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
    const n = Number(String(value).replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  private status(value: unknown) {
    const s = String(value ?? "AVAILABLE").toUpperCase();
    return s.includes("SOLD")
      ? UnitStatus.SOLD
      : s.includes("RESERV")
        ? UnitStatus.RESERVED
        : s.includes("UNAV")
          ? UnitStatus.UNAVAILABLE
          : UnitStatus.AVAILABLE;
  }

  private rowErrors(row: Record<string, unknown>, analysis: Analysis) {
    const values = this.valuesForRow(row, analysis);
    const errors: Array<{ field: string; code: string }> = [];
    if (!String(values.externalUnitId ?? "").trim()) errors.push({ field: "externalUnitId", code: "REQUIRED" });
    for (const field of ["bedrooms", "bathrooms", "builtUpArea", "landArea", "gardenArea", "roofArea", "terraceArea", "price", "downPayment", "installmentYears", "installmentAmount", "maintenance"])
      if (values[field] != null && values[field] !== "" && this.number(values[field]) == null) errors.push({ field, code: "INVALID_NUMBER" });
    if (values.deliveryDate != null && values.deliveryDate !== "" && !parseImportDate(values.deliveryDate)) errors.push({ field: "deliveryDate", code: "INVALID_DATE" });
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
        values[field] =
          analysis.valueMappings[field]?.[this.normalize(String(raw))] ?? raw;
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
      status: contactSales
        ? UnitStatus.CONTACT_SALES
        : values.status != null
          ? this.status(values.status)
          : undefined,
      deliveryDate,
      deliveryYears: this.number(values.deliveryYears),
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

  async confirm(id: string) {
    const item = await this.get(id);
    const unresolved = item.issues.filter(
      (i) => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt,
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
        const sourceMetadata: Record<string, unknown> = Object.fromEntries((analysis.metadataColumns ?? []).filter(header => row[header] != null && row[header] !== "").map(header => [header, row[header]]));
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
            const incomingPlans = this.paymentPlansForRow(
              row,
              analysis,
              rowIndex + 2,
              id,
              item.fileName,
            );
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
    mode: "DELETE_SOURCE_RECORD" | "DELETE_EXCLUSIVE_RECORDS" | "ROLLBACK_SAFE",
  ) {
    const item = await this.get(id);
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
