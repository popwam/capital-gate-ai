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

const CANONICAL = [
  "externalUnitId",
  "phase",
  "cluster",
  "building",
  "floor",
  "unitType",
  "unitSubType",
  "bedrooms",
  "bathrooms",
  "builtUpArea",
  "landArea",
  "gardenArea",
  "roofArea",
  "terraceArea",
  "price",
  "currency",
  "status",
  "deliveryDate",
  "deliveryYears",
  "finishingType",
  "downPayment",
  "installmentYears",
  "installmentAmount",
  "maintenance",
  "clubFees",
  "discount",
  "offerText",
];
const KNOWN: Record<string, string> = {
  "unit no": "externalUnitId",
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
  "total price": "price",
  currency: "currency",
  status: "status",
  availability: "status",
  delivery: "deliveryDate",
  "delivery date": "deliveryDate",
  finishing: "finishingType",
  السعر: "price",
  "السعر الإجمالي": "price",
  العملة: "currency",
  الحالة: "status",
  الإتاحة: "status",
  الاستلام: "deliveryDate",
  التشطيب: "finishingType",
  dp: "downPayment",
  "down payment": "downPayment",
  years: "installmentYears",
  "installment years": "installmentYears",
  installment: "installmentAmount",
  maintenance: "maintenance",
  "club fees": "clubFees",
  discount: "discount",
  offer: "offerText",
  phase: "phase",
  cluster: "cluster",
  building: "building",
  floor: "floor",
  المقدم: "downPayment",
  "سنوات التقسيط": "installmentYears",
  القسط: "installmentAmount",
  الصيانة: "maintenance",
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
    const mappingSources: Record<string, string> = {};
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
      if (field) {
        mappings[header] = field;
        mappingSources[header] = prior ? "APPROVED_MEMORY" : "KNOWN_RULE";
      }
    }
    const unknown = headers.filter((h) => !mappings[h]);
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
              ![
                "price",
                "currency",
                "downPayment",
                "installmentAmount",
                "discount",
                "status",
              ].includes(suggestion.canonicalField)
            ) {
              mappings[suggestion.sourceColumn] = suggestion.canonicalField;
              mappingSources[suggestion.sourceColumn] = "AI_HIGH_CONFIDENCE";
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
        message:
          "I could not identify the unit number/code. Enter the exact source column header that uniquely identifies each unit.",
      });
    if (!mapped.has("currency"))
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "currency",
        message:
          "The workbook does not contain currency. What currency applies to all prices?",
      });
    if (!analysis.metadata.projectId && !analysis.metadata.projectName)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "projectName",
        message: "What project does this file belong to?",
      });
    if (!analysis.metadata.developerId && !analysis.metadata.developerName)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "developerName",
        message: "Which developer supplied this inventory?",
      });
    if (!analysis.metadata.locationId)
      issues.push({
        importId,
        severity: IssueSeverity.BLOCKING,
        field: "locationId",
        message: "Which existing area or subarea contains this project?",
      });
    for (const column of analysis.unknownColumns)
      issues.push({
        importId,
        severity: IssueSeverity.WARNING,
        field: `column:${column}`,
        message: `The column “${column}” is not mapped. Choose a canonical field, METADATA to preserve it with provenance, or IGNORE.`,
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
            severity: IssueSeverity.WARNING,
            field: `value:unitType:${raw}`,
            message: `What does the unit type abbreviation “${raw}” mean? Enter its canonical value or IGNORE.`,
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

  async resolve(id: string, field: string, value: unknown) {
    const item = await this.get(id);
    const analysis = item.analysis as unknown as Analysis;
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
    } else if (field.startsWith("value:")) {
      const [, canonical, raw] = field.split(":");
      if (value !== "IGNORE")
        (analysis.valueMappings[canonical] ??= {})[this.normalize(raw)] =
          String(value);
    } else if (
      [
        "projectId",
        "projectName",
        "developerId",
        "developerName",
        "locationId",
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
        where: { importId: id, field },
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
      updatedUnits = 0;
    const changeExamples: unknown[] = [];
    if (externalHeader)
      for (const row of analysis.rows) {
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
        const plan = prior.paymentPlans[0];
        const planChanged =
          (updateData.downPayment != null &&
            !this.sameValue(plan?.downPayment, updateData.downPayment)) ||
          (updateData.installmentYears != null &&
            !this.sameValue(
              plan?.installmentYears,
              updateData.installmentYears,
            )) ||
          (updateData.installmentAmount != null &&
            !this.sameValue(
              plan?.installmentAmount,
              updateData.installmentAmount,
            ));
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
      canConfirm: blocking === 0 && duplicateIdentifiers === 0,
    };
    await this.prisma.dataImport.update({
      where: { id },
      data: {
        preview: this.json(preview),
        status:
          blocking || duplicateIdentifiers
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
  private unitData(
    values: Record<string, unknown>,
    contactSales: boolean,
  ): Prisma.UnitUncheckedUpdateInput {
    const text = (field: string) =>
      values[field] == null || values[field] === ""
        ? undefined
        : String(values[field]);
    const date = text("deliveryDate");
    return {
      phase: text("phase"),
      cluster: text("cluster"),
      building: text("building"),
      floor: text("floor"),
      unitType: text("unitType"),
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
      deliveryDate: date ? new Date(date) : undefined,
      deliveryYears: this.number(values.deliveryYears),
      finishingType: text("finishingType"),
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
          field !== "availabilityUpdatedAt" &&
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
          let developerId = item.developerId || analysis.metadata.developerId;
          let projectId = item.projectId || analysis.metadata.projectId;
          if (!developerId) {
            const name = analysis.metadata.developerName;
            const slug = this.normalize(name).replace(/ /g, "-");
            developerId = (
              await tx.developer.upsert({
                where: { slug },
                create: { name, slug },
                update: {},
              })
            ).id;
          }
          if (!projectId) {
            const name = analysis.metadata.projectName;
            const slugBase = this.normalize(name).replace(/ /g, "-");
            const slug = `${slugBase}-${developerId.slice(-5)}`;
            projectId = (
              await tx.project.upsert({
                where: { developerId_name: { developerId, name } },
                create: {
                  developerId,
                  name,
                  slug,
                  locationId: analysis.metadata.locationId,
                },
                update: { locationId: analysis.metadata.locationId },
              })
            ).id;
          }
          let created = 0,
            updated = 0,
            rejected = 0,
            skipped = 0;
          const importedIdentifiers = new Set<string>();
          for (const row of analysis.rows) {
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
        const sourceMetadata = Object.fromEntries((analysis.metadataColumns ?? []).filter(header => row[header] != null && row[header] !== "").map(header => [header, row[header]]));
        if (Object.keys(sourceMetadata).length) updateData.sourceMetadata = this.json(sourceMetadata);
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
            const activeOffer = existing?.offers.find(
              (offer) => offer.isActive,
            );
            const planChanged =
              updateData.downPayment != null ||
              updateData.installmentYears != null ||
              updateData.installmentAmount != null
                ? !activePlan ||
                  (updateData.downPayment != null &&
                    !this.sameValue(
                      activePlan.downPayment,
                      updateData.downPayment,
                    )) ||
                  (updateData.installmentYears != null &&
                    !this.sameValue(
                      activePlan.installmentYears,
                      updateData.installmentYears,
                    )) ||
                  (updateData.installmentAmount != null &&
                    !this.sameValue(
                      activePlan.installmentAmount,
                      updateData.installmentAmount,
                    ))
                : false;
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
              planChanged ||
              (!existing &&
                (updateData.downPayment != null ||
                  updateData.installmentYears != null ||
                  updateData.installmentAmount != null))
            ) {
              await tx.paymentPlan.updateMany({
                where: { unitId: unit.id, isActive: true },
                data: { isActive: false },
              });
              await tx.paymentPlan.create({
                data: {
                  unitId: unit.id,
                  name: activePlan?.name || "Imported payment plan",
                  downPayment: (updateData.downPayment ??
                    activePlan?.downPayment) as any,
                  installmentYears: (updateData.installmentYears ??
                    activePlan?.installmentYears) as any,
                  installmentAmount: (updateData.installmentAmount ??
                    activePlan?.installmentAmount) as any,
                  notes: activePlan?.notes,
                  isActive: true,
                },
              });
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
