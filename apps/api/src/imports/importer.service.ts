import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ImportStatus, IssueSeverity, Prisma, UnitStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";
import { PrismaService } from "../database/prisma.service";
import { StorageService } from "../storage/storage.service";
import { AIProvider } from "../providers/ai-provider";

const CANONICAL = ["externalUnitId", "phase", "cluster", "building", "floor", "unitType", "unitSubType", "bedrooms", "bathrooms", "builtUpArea", "landArea", "gardenArea", "roofArea", "terraceArea", "price", "currency", "status", "deliveryDate", "deliveryYears", "finishingType", "downPayment", "installmentYears", "installmentAmount", "maintenance", "clubFees", "discount", "offerText"];
const KNOWN: Record<string, string> = {
  "unit no": "externalUnitId", "unit number": "externalUnitId", "unit id": "externalUnitId", "property id": "externalUnitId", "code": "externalUnitId",
  "type": "unitType", "unit type": "unitType", "property type": "unitType", "subtype": "unitSubType", "bedrooms": "bedrooms", "beds": "bedrooms", "br": "bedrooms", "bathrooms": "bathrooms", "baths": "bathrooms",
  "bua": "builtUpArea", "built up area": "builtUpArea", "unit area": "builtUpArea", "area": "builtUpArea", "land area": "landArea", "garden": "gardenArea", "roof": "roofArea", "terrace": "terraceArea",
  "price": "price", "total price": "price", "currency": "currency", "status": "status", "availability": "status", "delivery": "deliveryDate", "delivery date": "deliveryDate", "finishing": "finishingType",
  "dp": "downPayment", "down payment": "downPayment", "years": "installmentYears", "installment years": "installmentYears", "installment": "installmentAmount", "maintenance": "maintenance", "club fees": "clubFees", "discount": "discount", "offer": "offerText", "phase": "phase", "cluster": "cluster", "building": "building", "floor": "floor"
};
type Analysis = { sheetName: string; sheets: string[]; headers: string[]; rows: Record<string, unknown>[]; mappings: Record<string, string>; mappingSources: Record<string, string>; valueMappings: Record<string, Record<string,string>>; rowPolicies: Record<string,string>; unknownColumns: string[]; aiSuggestions: unknown[]; defaultValues: Record<string, unknown>; metadata: Record<string, string>; fileKey: string };

@Injectable()
export class ImporterService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, @Inject("AI_PROVIDER") private readonly ai: AIProvider) {}
  private normalize(v: string) { return v.toLowerCase().trim().replace(/[_-]+/g, " ").replace(/\s+/g, " "); }
  private json<T>(value: T): any { return JSON.parse(JSON.stringify(value)); }

  async analyze(file: Express.Multer.File, metadata: Record<string, string>) {
    const workbook = XLSX.read(file.buffer, { type: "buffer", cellDates: true });
    if (!workbook.SheetNames.length) throw new BadRequestException("Workbook contains no sheets");
    const sheetName = workbook.SheetNames.find(name => XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1 }).length > 1) ?? workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: null, raw: true });
    if (!rows.length) throw new BadRequestException("Selected sheet contains no data rows");
    if (rows.length > 10_000) throw new BadRequestException("Imports are limited to 10,000 rows per file");
    const headers = Object.keys(rows[0]); const mappings: Record<string, string> = {}; const mappingSources: Record<string, string> = {};
    const developerSlug = metadata.developerSlug || "__global__";
    const remembered = await this.prisma.importMapping.findMany({ where: { approved: true, developerSlug: { in: [developerSlug, "__global__"] } } });
    for (const header of headers) { const normalized = this.normalize(header); const prior = remembered.find(m => m.normalizedColumn === normalized); const field = prior?.canonicalField ?? KNOWN[normalized]; if (field) { mappings[header] = field; mappingSources[header] = prior ? "APPROVED_MEMORY" : "KNOWN_RULE"; } }
    const unknown = headers.filter(h => !mappings[h]);
    const aiSuggestions = unknown.length ? await this.ai.mapColumns(unknown, rows.slice(0, 5).map(row => unknown.map(h => row[h])), CANONICAL) : [];
    for (const suggestion of aiSuggestions) { if (suggestion.confidence >= .95 && CANONICAL.includes(suggestion.canonicalField) && !["price", "currency", "downPayment", "installmentAmount", "discount", "status"].includes(suggestion.canonicalField)) { mappings[suggestion.sourceColumn] = suggestion.canonicalField; mappingSources[suggestion.sourceColumn] = "AI_HIGH_CONFIDENCE"; } }
    const valueMappings: Record<string,Record<string,string>> = {}; const priorValues = await this.prisma.importValueMapping.findMany({ where: { developerSlug: { in: [developerSlug,"__global__"] }, approved: true } });
    for (const item of priorValues) (valueMappings[item.canonicalField] ??= {})[item.normalizedValue] = item.targetValue;
    const stored = await this.storage.put(file.buffer, file.originalname, file.mimetype, "imports"); const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const analysis: Analysis = { sheetName, sheets: workbook.SheetNames, headers, rows: this.json(rows), mappings, mappingSources, valueMappings, rowPolicies: {}, unknownColumns: headers.filter(h => !mappings[h]), aiSuggestions, defaultValues: {}, metadata, fileKey: stored.key };
    const dataImport = await this.prisma.dataImport.create({ data: { fileName: file.originalname, fileHash, fileUrl: stored.url, status: ImportStatus.NEEDS_INPUT, rowsDetected: rows.length, mappingConfig: this.json({ mappings, mappingSources }), analysis: this.json(analysis), developerId: metadata.developerId || undefined, projectId: metadata.projectId || undefined } });
    await this.createIssues(dataImport.id, analysis);
    return this.get(dataImport.id);
  }

  private async createIssues(importId: string, analysis: Analysis) {
    const mapped = new Set(Object.values(analysis.mappings)); const issues: Prisma.ImportIssueCreateManyInput[] = [];
    if (!mapped.has("externalUnitId")) issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "mapping:externalUnitId", message: "I could not identify the unit number/code. Enter the exact source column header that uniquely identifies each unit." });
    if (!mapped.has("currency")) issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "currency", message: "The workbook does not contain currency. What currency applies to all prices?" });
    if (!analysis.metadata.projectId && !analysis.metadata.projectName) issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "projectName", message: "What project does this file belong to?" });
    if (!analysis.metadata.developerId && !analysis.metadata.developerName) issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "developerName", message: "Which developer supplied this inventory?" });
    if (!analysis.metadata.locationId) issues.push({ importId, severity: IssueSeverity.BLOCKING, field: "locationId", message: "Which existing area or subarea contains this project?" });
    for (const column of analysis.unknownColumns) issues.push({ importId, severity: IssueSeverity.WARNING, field: `column:${column}`, message: `The column “${column}” is not mapped. Choose a canonical field or ignore it.` });
    const typeHeader = Object.entries(analysis.mappings).find(([,field]) => field === "unitType")?.[0];
    if (typeHeader) for (const raw of [...new Set(analysis.rows.map(row => String(row[typeHeader] ?? "").trim()).filter(Boolean))]) if (/^[A-Z]{1,3}$/.test(raw) && !analysis.valueMappings.unitType?.[this.normalize(raw)]) issues.push({ importId, severity: IssueSeverity.WARNING, field: `value:unitType:${raw}`, message: `What does the unit type abbreviation “${raw}” mean? Enter its canonical value or IGNORE.` });
    for (const [header, canonical] of Object.entries(analysis.mappings)) { const missing = analysis.rows.filter(r => r[header] == null || r[header] === "").length; if (missing) issues.push({ importId, severity: canonical === "externalUnitId" ? IssueSeverity.ERROR : IssueSeverity.WARNING, field: canonical, message: `${missing} rows are missing ${canonical}.`, resolution: { missingRows: missing } }); }
    if (issues.length) await this.prisma.importIssue.createMany({ data: issues });
  }

  async get(id: string) { const item = await this.prisma.dataImport.findUnique({ where: { id }, include: { issues: { orderBy: [{ severity: "desc" }, { id: "asc" }] }, developer: true, project: true } }); if (!item) throw new NotFoundException("Import not found"); return item; }
  async list() { return this.prisma.dataImport.findMany({ orderBy: { uploadedAt: "desc" }, take: 100, include: { developer: true, project: true, issues: true } }); }

  async resolve(id: string, field: string, value: unknown) {
    const item = await this.get(id); const analysis = item.analysis as unknown as Analysis;
    if (field.startsWith("column:")) { const header = field.slice(7); if (value === "IGNORE") analysis.unknownColumns = analysis.unknownColumns.filter(x => x !== header); else { if (!CANONICAL.includes(String(value))) throw new BadRequestException("Invalid canonical field"); analysis.mappings[header] = String(value); analysis.mappingSources[header] = "ADMIN_APPROVED"; analysis.unknownColumns = analysis.unknownColumns.filter(x => x !== header); } }
    else if (field.startsWith("mapping:")) { const canonical = field.slice(8); const header = String(value); if (!analysis.headers.includes(header) || !CANONICAL.includes(canonical)) throw new BadRequestException("Choose an existing source header"); analysis.mappings[header] = canonical; analysis.mappingSources[header] = "ADMIN_APPROVED"; analysis.unknownColumns = analysis.unknownColumns.filter(x => x !== header); }
    else if (field.startsWith("value:")) { const [,canonical,raw] = field.split(":"); if (value !== "IGNORE") (analysis.valueMappings[canonical] ??= {})[this.normalize(raw)] = String(value); }
    else if (["projectId", "projectName", "developerId", "developerName", "locationId"].includes(field)) analysis.metadata[field] = String(value);
    else if (["LEAVE_EMPTY","EXCLUDE_ROWS","CONTACT_SALES"].includes(String(value))) analysis.rowPolicies[field] = String(value);
    else analysis.defaultValues[field] = value;
    await this.prisma.$transaction([this.prisma.dataImport.update({ where: { id }, data: { analysis: this.json(analysis), mappingConfig: this.json({ mappings: analysis.mappings, mappingSources: analysis.mappingSources }) } }), this.prisma.importIssue.updateMany({ where: { importId: id, field }, data: { resolvedAt: new Date(), resolution: this.json({ value }) } })]);
    return this.preview(id);
  }

  async preview(id: string) {
    const item = await this.get(id); const analysis = item.analysis as unknown as Analysis; const blocking = item.issues.filter(i => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt).length;
    const externalHeader = Object.entries(analysis.mappings).find(([,v]) => v === "externalUnitId")?.[0]; const valid = externalHeader ? analysis.rows.filter(r => r[externalHeader] != null && r[externalHeader] !== "").length : 0;
    const preview = { project: analysis.metadata.projectName || item.project?.name, developer: analysis.metadata.developerName || item.developer?.name, locationId: analysis.metadata.locationId, rowsFound: analysis.rows.length, valid, rejected: analysis.rows.length - valid, blockingIssues: blocking, canConfirm: blocking === 0 };
    await this.prisma.dataImport.update({ where: { id }, data: { preview: this.json(preview), status: blocking ? ImportStatus.NEEDS_INPUT : ImportStatus.READY } }); return { ...(await this.get(id)), preview };
  }

  private number(value: unknown) { if (value == null || value === "") return undefined; const n = Number(String(value).replace(/[,\s]/g, "")); return Number.isFinite(n) ? n : undefined; }
  private status(value: unknown) { const s = String(value ?? "AVAILABLE").toUpperCase(); return s.includes("SOLD") ? UnitStatus.SOLD : s.includes("RESERV") ? UnitStatus.RESERVED : s.includes("UNAV") ? UnitStatus.UNAVAILABLE : UnitStatus.AVAILABLE; }

  async confirm(id: string) {
    const item = await this.get(id); const unresolved = item.issues.filter(i => i.severity === IssueSeverity.BLOCKING && !i.resolvedAt); if (unresolved.length) throw new BadRequestException("Resolve all blocking issues before import");
    const analysis = item.analysis as unknown as Analysis;
    const result = await this.prisma.$transaction(async tx => {
      let developerId = item.developerId || analysis.metadata.developerId; let projectId = item.projectId || analysis.metadata.projectId;
      if (!developerId) { const name = analysis.metadata.developerName; const slug = this.normalize(name).replace(/ /g, "-"); developerId = (await tx.developer.upsert({ where: { slug }, create: { name, slug }, update: {} })).id; }
      if (!projectId) { const name = analysis.metadata.projectName; const slugBase = this.normalize(name).replace(/ /g, "-"); const slug = `${slugBase}-${developerId.slice(-5)}`; projectId = (await tx.project.upsert({ where: { developerId_name: { developerId, name } }, create: { developerId, name, slug, locationId: analysis.metadata.locationId }, update: { locationId: analysis.metadata.locationId } })).id; }
      let created = 0, updated = 0, rejected = 0;
      for (const row of analysis.rows) {
        const values: Record<string, unknown> = { ...analysis.defaultValues }; for (const [header, field] of Object.entries(analysis.mappings)) if (row[header] != null && row[header] !== "") { const raw = row[header]; values[field] = analysis.valueMappings[field]?.[this.normalize(String(raw))] ?? raw; }
        if (Object.entries(analysis.rowPolicies).some(([field,policy]) => policy === "EXCLUDE_ROWS" && (values[field] == null || values[field] === ""))) { rejected++; continue; }
        const externalUnitId = String(values.externalUnitId ?? "").trim(); if (!externalUnitId) { rejected++; continue; }
        const existing = await tx.unit.findUnique({ where: { developerId_projectId_externalUnitId: { developerId, projectId, externalUnitId } }, select: { id: true, price: true } });
        const contactSales = Object.entries(analysis.rowPolicies).some(([field,policy]) => policy === "CONTACT_SALES" && (values[field] == null || values[field] === ""));
        const data: Prisma.UnitUncheckedCreateInput = { externalUnitId, developerId, projectId, sourceImportId: id, phase: values.phase ? String(values.phase) : undefined, cluster: values.cluster ? String(values.cluster) : undefined, building: values.building ? String(values.building) : undefined, floor: values.floor ? String(values.floor) : undefined, unitType: values.unitType ? String(values.unitType) : undefined, unitSubType: values.unitSubType ? String(values.unitSubType) : undefined, bedrooms: this.number(values.bedrooms), bathrooms: this.number(values.bathrooms), builtUpArea: this.number(values.builtUpArea), landArea: this.number(values.landArea), gardenArea: this.number(values.gardenArea), roofArea: this.number(values.roofArea), terraceArea: this.number(values.terraceArea), price: this.number(values.price), currency: String(values.currency ?? analysis.defaultValues.currency ?? ""), status: contactSales ? UnitStatus.CONTACT_SALES : this.status(values.status), deliveryDate: values.deliveryDate ? new Date(String(values.deliveryDate)) : undefined, deliveryYears: this.number(values.deliveryYears), finishingType: values.finishingType ? String(values.finishingType) : undefined, downPayment: this.number(values.downPayment), installmentYears: this.number(values.installmentYears), installmentAmount: this.number(values.installmentAmount), maintenance: this.number(values.maintenance), clubFees: this.number(values.clubFees), discount: this.number(values.discount), offerText: values.offerText ? String(values.offerText) : undefined, availabilityUpdatedAt: new Date() };
        const unit = await tx.unit.upsert({ where: { developerId_projectId_externalUnitId: { developerId, projectId, externalUnitId } }, create: data, update: data }); existing ? updated++ : created++;
        if (data.downPayment != null || data.installmentYears != null || data.installmentAmount != null) { await tx.paymentPlan.deleteMany({ where: { unitId: unit.id } }); await tx.paymentPlan.create({ data: { unitId: unit.id, name: "Imported payment plan", downPayment: data.downPayment, installmentYears: data.installmentYears, installmentAmount: data.installmentAmount, isActive: true } }); }
        if (data.offerText || data.discount != null) { await tx.offer.deleteMany({ where: { unitId: unit.id } }); await tx.offer.create({ data: { unitId: unit.id, title: data.offerText || "Imported offer", description: data.offerText, discountAmount: data.discount, isActive: true } }); }
        if (data.price != null && (!existing?.price || existing.price.toString() !== String(data.price))) await tx.unitPriceHistory.create({ data: { unitId: unit.id, price: data.price, currency: data.currency || "", importId: id } });
      }
      for (const [header, canonicalField] of Object.entries(analysis.mappings)) { const developerSlug = analysis.metadata.developerSlug || "__global__"; await tx.importMapping.upsert({ where: { developerSlug_normalizedColumn: { developerSlug, normalizedColumn: this.normalize(header) } }, create: { developerSlug, sourceColumn: header, normalizedColumn: this.normalize(header), canonicalField, approved: true, confidence: analysis.mappingSources[header] === "AI_HIGH_CONFIDENCE" ? .95 : 1 }, update: { canonicalField, approved: true } }); }
      for (const [canonicalField,mappings] of Object.entries(analysis.valueMappings)) for (const [normalizedValue,targetValue] of Object.entries(mappings)) { const developerSlug=analysis.metadata.developerSlug||"__global__"; await tx.importValueMapping.upsert({where:{developerSlug_canonicalField_normalizedValue:{developerSlug,canonicalField,normalizedValue}},create:{developerSlug,canonicalField,sourceValue:normalizedValue,normalizedValue,targetValue,approved:true},update:{targetValue,approved:true}}); }
      await tx.dataImport.update({ where: { id }, data: { developerId, projectId, status: ImportStatus.COMPLETED, rowsCreated: created, rowsUpdated: updated, rowsRejected: rejected } }); return { developerId, projectId, created, updated, rejected };
    }, { timeout: 120_000 }); return { import: await this.get(id), result };
  }
}
