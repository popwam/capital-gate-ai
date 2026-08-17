import * as XLSX from "xlsx";

export type SheetRole = "INVENTORY" | "PAYMENT_PLAN" | "PRICE_LIST" | "PROJECT_INFO" | "SUMMARY" | "AMENITIES" | "LOCATIONS" | "AVAILABILITY" | "KNOWLEDGE" | "MIXED" | "UNKNOWN";
export type MappingConfidence = "HIGH" | "MEDIUM" | "LOW";
export type CellValue = string | number | boolean | Date | null;
export type SemanticField = "externalUnitId" | "project" | "developer" | "phase" | "cluster" | "building" | "buildingCode" | "zone" | "floor" | "unitType" | "unitSubType" | "bedrooms" | "bathrooms" | "builtUpArea" | "netArea" | "grossArea" | "landArea" | "gardenArea" | "roofArea" | "terraceArea" | "balconyArea" | "price" | "originalPrice" | "pricePerSqm" | "currency" | "downPayment" | "downPaymentPercent" | "installmentYears" | "installmentMonths" | "installmentAmount" | "deliveryDate" | "deliveryYear" | "finishingType" | "status" | "maintenance" | "maintenancePercent" | "clubFees" | "discount" | "discountPercent" | "view" | "orientation" | "parkingSpaces" | "propertyUse" | "commercialActivity" | "rentalPrice" | "expectedYield" | "paidAmount" | "remainingAmount" | "notes";

export interface HeaderCandidate { row: number; confidence: number; score: number; validHeaderCount: number; domainMatches: number; rejected: Array<{ value: string; reason: string }>; }
export interface DetectedColumn { key: string; columnIndex: number; originalHeader: string; normalizedHeader: string; semanticField?: SemanticField; confidence: number; confidenceLevel: MappingConfidence; samples: CellValue[]; }
export interface DetectedTable { id: string; sheetName: string; startRow: number; endRow: number; startColumn: number; endColumn: number; headerRow: number; dataRowCount: number; confidence: number; columns: DetectedColumn[]; previewRows: Record<string, CellValue>[]; ignoredRowsAbove: number; ignoredRowsBelow: number; warnings: string[]; }
export interface DetectedRegion { type: "TABLE" | "KEY_VALUE" | "SUMMARY" | "UNSTRUCTURED"; startRow: number; endRow: number; startColumn: number; endColumn: number; confidence: number; tableId?: string; }
export interface SheetAnalysis { name: string; rowCount: number; columnCount: number; populatedCellCount?: number; usedRange?: string; hiddenRows: number[]; hiddenColumns: number[]; merges: string[]; formulaCellCount: number; classification: SheetRole; confidence: number; candidateTables: DetectedTable[]; headerCandidates: HeaderCandidate[]; regions: DetectedRegion[]; warnings: string[]; rawPreview: Array<{ row: number; cells: CellValue[] }>; }
export interface WorkbookAnalysis { workbookName: string; sheets: SheetAnalysis[]; selectedSheet?: string; selectedTableId?: string; inventorySheetCount: number; warnings: string[]; }

const artifacts = /^(?:_*empty(?:_+\d+)?_*|__empty(?:_\d+)?|unnamed:\s*\d+|column\s*\d+)$/iu;
const summaryLabels = /^(?:num(?:ber)? of units|total no\.? of units|total price of units|total value|value|total|grand total|total units|count|average|summary|totals|الإجمالي|عدد الوحدات|القيمة الإجمالية)\s*:?$/iu;
const totalRow = /^(?:total(?:\s+(?:no\.?\s+of\s+units|price\s+of\s+units|value|units))?|grand total|totals?|average|count|summary|الإجمالي|الاجمالي|المجموع|عدد الوحدات|القيمة الإجمالية)\b/iu;

export function normalizeHeader(value: string) {
  return value.normalize("NFKC").trim().replace(/[\r\n\t]+/g, " ").replace(/[_-]+/g, " ").replace(/\s+/g, " ").replace(/^[:;|]+|[:;|]+$/g, "").toLowerCase();
}

export function invalidHeaderReason(value: unknown) {
  if (value == null || String(value).trim() === "") return "EMPTY";
  if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) return "DATA_VALUE";
  const text = String(value).trim();
  const normalized = normalizeHeader(text);
  if (artifacts.test(normalized)) return "PARSER_ARTIFACT";
  if (summaryLabels.test(normalized)) return "SUMMARY_LABEL";
  if (/^(?:true|false)$/i.test(normalized) || /^[-+]?\d[\d,]*(?:\.\d+)?%?$/.test(normalized) || /^(?:19|20)\d{2}$/.test(normalized)) return "DATA_VALUE";
  if (text.length > 100) return "TOO_LONG";
  return undefined;
}

const semanticRules: Array<[SemanticField, RegExp, number]> = [
  ["externalUnitId", /^(?:unit\s*(?:no|number|#|id|code|ref(?:erence)?)|property\s*(?:id|ref)|code|كود\s*الوحده|رقم\s*الوحده|مرجع\s*الوحده)$/iu, .98],
  ["project", /^(?:project|project name|المشروع|اسم المشروع)$/iu, .96],
  ["developer", /^(?:developer|developer name|المطور|اسم المطور)$/iu, .96],
  ["unitType", /^(?:unit|property)\s*type$|^type$|نوع\s*الوحده|نوع\s*العقار/iu, .96],
  ["builtUpArea", /^(?:bua|built\s*up\s*area|built\s*area|unit\s*area|area|المساحه|المساحه\s*المبنيه)$/iu, .94],
  ["landArea", /^(?:land\s*area|plot\s*area|مساحه\s*الارض)$/iu, .96],
  ["gardenArea", /^(?:garden\s*area|garden|مساحه\s*الحديقه)$/iu, .95],
  ["terraceArea", /^(?:terrace\s*area|terrace|مساحه\s*التراس)$/iu, .94],
  ["price", /^(?:price|total\s*(?:unit\s*)?price|standard\s*price|unit\s*price|السعر|السعر\s*الاجمالي)$/iu, .97],
  ["currency", /^(?:currency|curr|العمله)$/iu, .98],
  ["bedrooms", /^(?:bedrooms?|beds?|br|غرف\s*النوم|غرف)$/iu, .96],
  ["bathrooms", /^(?:bathrooms?|baths?|الحمامات)$/iu, .96],
  ["deliveryDate", /^(?:delivery|delivery\s*date|handover|handover\s*date|التسليم|تاريخ\s*التسليم|الاستلام)$/iu, .91],
  ["finishingType", /^(?:finishing|finish|finishing\s*type|التشطيب|نوع\s*التشطيب)$/iu, .94],
  ["status", /^(?:status|availability|unit\s*status|الحاله|الاتاحه|التوفر)$/iu, .96],
  ["downPayment", /^(?:down\s*payment|dp|المقدم|مقدم)$/iu, .91],
  ["installmentYears", /^(?:installment\s*(?:years|duration)|payment\s*years|years|سنوات\s*التقسيط|مده\s*السداد)$/iu, .88],
  ["installmentAmount", /^(?:installment(?:\s*amount)?|قسط|قيمه\s*القسط)$/iu, .88],
  ["phase", /^(?:phase|المرحله)$/iu, .94],
  ["cluster", /^(?:cluster|community|الكلاستر|المجموعه|المجتمع)$/iu, .91],
  ["building", /^(?:building|building\s*no|المبني|رقم\s*المبني)$/iu, .94],
  ["buildingCode", /^(?:building\s*(?:code|id)|كود\s*المبني)$/iu, .93],
  ["zone", /^(?:zone|district|المنطقه|الزون)$/iu, .87], ["floor", /^(?:floor|level|الدور)$/iu, .95],
  ["unitSubType", /^(?:unit\s*sub\s*type|subtype|model|unit\s*model|موديل\s*الوحده|النوع\s*الفرعي)$/iu, .91],
  ["netArea", /^(?:net\s*area|net\s*sqm|المساحه\s*الصافيه)$/iu, .95],
  ["grossArea", /^(?:gross\s*area|gross\s*sqm|المساحه\s*الاجماليه)$/iu, .94],
  ["roofArea", /^(?:roof\s*area|roof|روف|مساحه\s*الروف)$/iu, .93],
  ["balconyArea", /^(?:balcony\s*area|balcony|مساحه\s*البلكونه)$/iu, .92],
  ["originalPrice", /^(?:original\s*price|list\s*price|price\s*before\s*discount|السعر\s*قبل\s*الخصم)$/iu, .93],
  ["pricePerSqm", /^(?:price\s*(?:per|\/)\s*(?:sqm|m2|meter)|sqm\s*price|سعر\s*المتر)$/iu, .97],
  ["deliveryYear", /^(?:delivery\s*year|handover\s*year|سنه\s*التسليم|سنه\s*الاستلام)$/iu, .95],
  ["downPaymentPercent", /^(?:down\s*payment\s*%|dp\s*%|نسبه\s*المقدم)$/iu, .96],
  ["installmentMonths", /^(?:installment\s*months|payment\s*months|شهور\s*التقسيط|مده\s*السداد\s*بالشهور)$/iu, .92],
  ["maintenance", /^(?:maintenance|maintenance\s*fees?|صيانه|وديعه\s*الصيانه)$/iu, .93],
  ["maintenancePercent", /^(?:maintenance\s*%|نسبه\s*الصيانه)$/iu, .96],
  ["clubFees", /^(?:club\s*fees?|clubhouse\s*fees?|رسوم\s*النادي)$/iu, .94],
  ["discount", /^(?:discount|discount\s*amount|خصم|قيمه\s*الخصم)$/iu, .91],
  ["discountPercent", /^(?:discount\s*%|discount\s*percent|نسبه\s*الخصم)$/iu, .96],
  ["view", /^(?:view|unit\s*view|اطلاله|الاطلاله)$/iu, .92],
  ["orientation", /^(?:orientation|direction|اتجاه|الاتجاه)$/iu, .90],
  ["parkingSpaces", /^(?:parking\s*(?:spaces?|slots?)|parking|جراج|اماكن\s*الركن)$/iu, .89],
  ["propertyUse", /^(?:property\s*use|usage|use|استخدام\s*العقار|النشاط)$/iu, .86],
  ["commercialActivity", /^(?:commercial\s*activity|activity|business\s*activity|النشاط\s*التجاري)$/iu, .91],
  ["rentalPrice", /^(?:rent|rental\s*price|asking\s*rent|الايجار|قيمه\s*الايجار)$/iu, .92],
  ["expectedYield", /^(?:expected\s*yield|yield|roi|العائد|العائد\s*المتوقع)$/iu, .91],
  ["paidAmount", /^(?:paid\s*amount|amount\s*paid|المدفوع|المبلغ\s*المدفوع)$/iu, .94],
  ["remainingAmount", /^(?:remaining\s*amount|outstanding|المتبقي|المبلغ\s*المتبقي)$/iu, .93],
  ["notes", /^(?:notes?|remarks?|comment|ملاحظات|ملحوظات)$/iu, .90],
];

export function detectSemanticColumn(header: string) {
  const normalized = normalizeHeader(header).replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي");
  for (const [field, rule, confidence] of semanticRules) if (rule.test(normalized)) return { field, confidence };
  return undefined;
}

function matrix(sheet: XLSX.WorkSheet): CellValue[][] {
  return XLSX.utils.sheet_to_json<CellValue[]>(sheet, { header: 1, defval: null, raw: true, blankrows: true })
    .map((row) => Array.isArray(row) ? row : []);
}
export function rawSheetMatrix(sheet: XLSX.WorkSheet) { return matrix(sheet); }
const filled = (row: CellValue[]) => row.reduce<number>((count, value) => count + (value != null && String(value).trim() !== "" ? 1 : 0), 0);

function headerCandidate(rows: CellValue[][], rowIndex: number, merges: XLSX.Range[]): HeaderCandidate {
  const row = rows[rowIndex] ?? [];
  const populated = row.filter((cell) => cell != null && String(cell).trim() !== "");
  const rejected = populated.flatMap((cell) => { const reason = invalidHeaderReason(cell); return reason ? [{ value: String(cell).slice(0, 100), reason }] : []; });
  const valid = populated.filter((cell) => !invalidHeaderReason(cell));
  const domainMatches = valid.filter((cell) => detectSemanticColumn(String(cell))).length;
  const unique = new Set(valid.map((cell) => normalizeHeader(String(cell)))).size;
  const dataRows = rows.slice(rowIndex + 1, rowIndex + 7).filter((candidate) => filled(candidate) >= Math.max(2, Math.floor(valid.length * .4)));
  const density = valid.length ? dataRows.reduce((sum, candidate) => sum + Math.min(1, filled(candidate) / valid.length), 0) / Math.max(1, dataRows.length) : 0;
  const mergedAcross = merges.some((merge) => merge.s.r === rowIndex && merge.e.c > merge.s.c);
  const numericRatio = populated.length ? rejected.filter((entry) => entry.reason === "DATA_VALUE").length / populated.length : 0;
  const score = Math.max(0, Math.min(1, domainMatches * .16 + valid.length * .045 + density * .28 + Math.min(dataRows.length, 4) * .04 + (unique === valid.length && valid.length > 1 ? .08 : 0) - rejected.length * .08 - numericRatio * .45 - (mergedAcross ? .25 : 0)));
  return { row: rowIndex + 1, confidence: Math.round(score * 100), score, validHeaderCount: valid.length, domainMatches, rejected };
}

function tableEnd(rows: CellValue[][], headerIndex: number, columnIndexes: number[]) {
  let end = headerIndex;
  let blankRun = 0;
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const values = columnIndexes.map((column) => rows[rowIndex]?.[column]);
    const count = filled(values);
    if (!count) { blankRun++; if (blankRun >= 2) break; continue; }
    blankRun = 0;
    if (totalRow.test(String(values.find((value) => value != null) ?? "").trim())) break;
    if (count >= Math.max(1, Math.floor(columnIndexes.length * .25))) end = rowIndex;
  }
  return end;
}

export function detectTableAt(rows: CellValue[][], sheetName: string, headerRow: number, confidence = .5): DetectedTable | undefined {
  const index = headerRow - 1;
  const header = rows[index] ?? [];
  const seen = new Map<string, number>();
  const columns: DetectedColumn[] = [];
  for (const [columnIndex, value] of header.entries()) {
    if (invalidHeaderReason(value)) continue;
    const originalHeader = String(value).trim();
    const normalizedHeader = normalizeHeader(originalHeader);
    const occurrence = (seen.get(normalizedHeader) ?? 0) + 1; seen.set(normalizedHeader, occurrence);
    const key = occurrence === 1 ? originalHeader : `${originalHeader} [column ${columnIndex + 1}]`;
    const semantic = detectSemanticColumn(originalHeader);
    const samples = rows.slice(index + 1, index + 11).map((row) => row[columnIndex] ?? null).filter((sample) => sample != null && String(sample).trim() !== "").slice(0, 3);
    columns.push({ key, columnIndex, originalHeader, normalizedHeader, semanticField: semantic?.field, confidence: semantic?.confidence ?? 0, confidenceLevel: !semantic ? "LOW" : semantic.confidence >= .93 ? "HIGH" : semantic.confidence >= .75 ? "MEDIUM" : "LOW", samples });
  }
  if (columns.length < 2) return undefined;
  const columnIndexes = columns.map((column) => column.columnIndex);
  const endIndex = tableEnd(rows, index, columnIndexes);
  if (endIndex <= index) return undefined;
  const dataRows = rows.slice(index + 1, endIndex + 1).filter((row) => filled(columnIndexes.map((column) => row[column])) > 0 && !totalRow.test(String(row[columnIndexes[0]] ?? "").trim()));
  const previewRows = dataRows.slice(0, 5).map((row) => Object.fromEntries(columns.map((column) => [column.key, row[column.columnIndex] ?? null])));
  return { id: `${sheetName}:${headerRow}:${columns[0].columnIndex + 1}`, sheetName, startRow: headerRow, endRow: endIndex + 1, startColumn: Math.min(...columnIndexes) + 1, endColumn: Math.max(...columnIndexes) + 1, headerRow, dataRowCount: dataRows.length, confidence: Math.round(confidence * 100), columns, previewRows, ignoredRowsAbove: index, ignoredRowsBelow: Math.max(0, rows.length - endIndex - 1), warnings: confidence < .65 ? ["HEADER_REVIEW_REQUIRED"] : [] };
}

function classify(name: string, rows: CellValue[][], tables: DetectedTable[]) {
  const normalizedName = normalizeHeader(name);
  const fields = new Set(tables.flatMap((table) => table.columns.map((column) => column.semanticField).filter(Boolean)));
  const keyValuePlanRows = rows.filter((row) => filled(row) === 2 && /(?:down payment|installment|maintenance|delivery|مقدم|تقسيط|صيانه|تسليم)/iu.test(String(row.find((cell) => cell != null) ?? ""))).length;
  const inventorySignals = ["externalUnitId", "unitType", "builtUpArea", "price", "status"].filter((field) => fields.has(field as SemanticField)).length;
  if (/payment|installment|plan|5\s*years?|8\s*years?|10\s*years?|سداد|تقسيط|خطط السداد/iu.test(normalizedName)) return { role: "PAYMENT_PLAN" as const, confidence: Math.min(96, 72 + keyValuePlanRows * 7) };
  if (inventorySignals >= 3 || (fields.has("externalUnitId") && fields.has("price"))) return { role: "INVENTORY" as const, confidence: Math.min(99, 60 + inventorySignals * 8) };
  if (fields.has("externalUnitId") || (/inventory|units?|availability|مخزون|وحدات/iu.test(normalizedName) && tables.length)) return { role: "INVENTORY" as const, confidence: Math.max(64, 56 + inventorySignals * 8) };
  if (keyValuePlanRows >= 2) return { role: "PAYMENT_PLAN" as const, confidence: Math.min(96, 65 + keyValuePlanRows * 7) };
  if (/price list|prices|الاسعار|الأسعار/iu.test(normalizedName) || fields.has("price")) return { role: "PRICE_LIST" as const, confidence: 72 };
  if (/availability|available|اتاحه|إتاحة|متاح/iu.test(normalizedName) || fields.has("status")) return { role: "AVAILABILITY" as const, confidence: 70 };
  if (/amenit|facilit|خدمات|مرافق/iu.test(normalizedName)) return { role: "AMENITIES" as const, confidence: 82 };
  if (/location|area|موقع|منطقه|منطقة/iu.test(normalizedName)) return { role: "LOCATIONS" as const, confidence: 78 };
  if (/summary|overview|project info|ملخص|بيانات المشروع/iu.test(normalizedName) || rows.filter((row) => filled(row) === 2).length >= 3) return { role: "SUMMARY" as const, confidence: 75 };
  if (/note|knowledge|description|ملاحظات|وصف/iu.test(normalizedName)) return { role: "KNOWLEDGE" as const, confidence: 72 };
  return { role: tables.length > 1 ? "MIXED" as const : "UNKNOWN" as const, confidence: tables.length ? 48 : 25 };
}

export function analyzeWorkbook(workbook: XLSX.WorkBook, workbookName: string): WorkbookAnalysis {
  const sheets = workbook.SheetNames.map((name): SheetAnalysis => {
    const sheet = workbook.Sheets[name]; const rows = matrix(sheet); const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]!) : undefined;
    const merges = sheet["!merges"] ?? [];
    const candidates = rows.slice(0, 250).map((_, index) => headerCandidate(rows, index, merges)).filter((candidate) => candidate.validHeaderCount >= 2 && candidate.score >= .28).sort((a, b) => b.score - a.score);
    const tables: DetectedTable[] = [];
    for (const candidate of candidates) {
      if (tables.some((table) => Math.abs(table.headerRow - candidate.row) < 3 || (candidate.row > table.headerRow && candidate.row <= table.endRow))) continue;
      const table = detectTableAt(rows, name, candidate.row, candidate.score); if (table) tables.push(table);
      if (tables.length >= 4) break;
    }
    tables.sort((a, b) => b.confidence - a.confidence || b.dataRowCount - a.dataRowCount);
    const classification = classify(name, rows, tables);
    const rawPreview = rows.slice(0, 50).map((cells, index) => ({ row: index + 1, cells: cells.slice(0, 30) }));
    const regions: DetectedRegion[] = tables.map((table) => ({ type: "TABLE", startRow: table.startRow, endRow: table.endRow, startColumn: table.startColumn, endColumn: table.endColumn, confidence: table.confidence, tableId: table.id }));
    if (classification.role === "PAYMENT_PLAN" && !tables.length) regions.push({ type: "KEY_VALUE", startRow: 1, endRow: rows.length, startColumn: 1, endColumn: Math.max(...rows.map((row) => row.length), 1), confidence: classification.confidence });
    const cellEntries = Object.values(sheet).filter((cell): cell is XLSX.CellObject => Boolean(cell && typeof cell === "object" && "t" in cell));
    return { name, rowCount: range ? range.e.r - range.s.r + 1 : rows.length, columnCount: range ? range.e.c - range.s.c + 1 : Math.max(...rows.map((row) => row.length), 0), usedRange: sheet["!ref"], hiddenRows: (sheet["!rows"] ?? []).flatMap((row, index) => row?.hidden ? [index + 1] : []), hiddenColumns: (sheet["!cols"] ?? []).flatMap((column, index) => column?.hidden ? [index + 1] : []), merges: merges.map(XLSX.utils.encode_range), formulaCellCount: cellEntries.filter((cell) => Boolean(cell.f)).length, classification: classification.role, confidence: classification.confidence, candidateTables: tables, headerCandidates: candidates.slice(0, 8), regions, warnings: !tables.length && classification.role === "INVENTORY" ? ["HEADER_NOT_FOUND"] : tables[0]?.confidence && tables[0].confidence < 65 ? ["LOW_CONFIDENCE_HEADER"] : [], rawPreview };
  });
  const inventory = sheets.filter((sheet) => sheet.classification === "INVENTORY" && sheet.candidateTables.length).sort((a, b) => b.confidence - a.confidence || (b.candidateTables[0]?.dataRowCount ?? 0) - (a.candidateTables[0]?.dataRowCount ?? 0));
  const selected = inventory[0];
  return { workbookName, sheets, selectedSheet: selected?.name, selectedTableId: selected?.candidateTables[0]?.id, inventorySheetCount: inventory.length, warnings: inventory.length ? inventory.length > 1 ? ["MULTIPLE_INVENTORY_SHEETS"] : [] : ["NO_INVENTORY_SHEET"] };
}

export function recordsForTable(workbook: XLSX.WorkBook, table: DetectedTable) {
  const rows = matrix(workbook.Sheets[table.sheetName]);
  return rows.slice(table.headerRow, table.endRow).filter((row) => !totalRow.test(String(row[table.columns[0]?.columnIndex] ?? "").trim()) && filled(table.columns.map((column) => row[column.columnIndex])) > 0).map((row) => Object.fromEntries(table.columns.map((column) => [column.key, row[column.columnIndex] ?? null])));
}
