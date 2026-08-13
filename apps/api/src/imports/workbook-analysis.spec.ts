import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { analyzeWorkbook, detectTableAt, invalidHeaderReason, rawSheetMatrix, recordsForTable } from "./workbook-analysis";

function workbook(sheets: Array<{ name: string; rows: unknown[][]; merges?: string[] }>) {
  const book = XLSX.utils.book_new();
  for (const source of sheets) {
    const sheet = XLSX.utils.aoa_to_sheet(source.rows);
    if (source.merges) sheet["!merges"] = source.merges.map(XLSX.utils.decode_range);
    XLSX.utils.book_append_sheet(book, sheet, source.name);
  }
  return book;
}
const inventoryRows = [
  ["Unit Number", "Unit Type", "BUA", "Total Price", "Status"],
  ["A-101", "Apartment", 120, 10_000_000, "Available"],
  ["A-102", "Apartment", 135, 11_000_000, "Available"],
];

test("A: normal row-one inventory table is detected", () => {
  const result = analyzeWorkbook(workbook([{ name: "Inventory", rows: inventoryRows }]), "normal.xlsx");
  assert.equal(result.selectedSheet, "Inventory");
  assert.equal(result.sheets[0].candidateTables[0].headerRow, 1);
});

test("B/C: titles and ten summary rows before inventory never become headers", () => {
  const prefix = [["Project XYZ Inventory"], ["Developer", "ABC"], ["Num of Units:", 2], ["Value:", 21_000_000], [], ["Summary"], ["Delivery", 2029], [], ["Notes"], []];
  const result = analyzeWorkbook(workbook([{ name: "Data", rows: [...prefix, ...inventoryRows] }]), "late.xlsx");
  const table = result.sheets[0].candidateTables[0];
  assert.equal(table.headerRow, 11);
  assert.deepEqual(table.columns.map((column) => column.originalHeader), inventoryRows[0]);
});

test("D/E/current regression: artifacts, numeric values and summary labels are rejected as headers", () => {
  const broken = [123, "EMPTY__", "EMPTY_1__", "EMPTY_2__", "EMPTY_3__", "EMPTY_4__", "Num of Units:", "Value:", "1,091,604,000", "__EMPTY_9", "Unnamed: 10"];
  const result = analyzeWorkbook(workbook([{ name: "Sheet1", rows: [broken, [], ...inventoryRows] }]), "regression.xlsx");
  const table = result.sheets[0].candidateTables[0];
  assert.equal(table.headerRow, 3);
  assert.ok(!table.columns.some((column) => /empty|unnamed|1,091|num of units|value:/i.test(column.originalHeader)));
  assert.equal(invalidHeaderReason("1,091,604,000"), "DATA_VALUE");
  assert.equal(invalidHeaderReason("Num of Units:"), "SUMMARY_LABEL");
});

test("F: merged project title is metadata and the later table wins", () => {
  const result = analyzeWorkbook(workbook([{ name: "Inventory", rows: [["Project XYZ Inventory", null, null, null, null], [], ...inventoryRows], merges: ["A1:E1"] }]), "merged.xlsx");
  assert.equal(result.sheets[0].candidateTables[0].headerRow, 3);
  assert.deepEqual(result.sheets[0].merges, ["A1:E1"]);
});

test("G/H: payment-plan key/value and matrix sheets are classified without inventory coercion", () => {
  const result = analyzeWorkbook(workbook([
    { name: "Terms", rows: [["Down Payment", "10%"], ["Installments", "8 Years"], ["Maintenance", "8%"], ["Delivery", 2029]] },
    { name: "Payment Plan", rows: [["Plan", "Down Payment", "Years", "Installment"], ["A", "10%", 8, 100_000], ["B", "15%", 10, 80_000]] },
  ]), "plans.xlsx");
  assert.deepEqual(result.sheets.map((sheet) => sheet.classification), ["PAYMENT_PLAN", "PAYMENT_PLAN"]);
  assert.equal(result.inventorySheetCount, 0);
});

test("I/O: two tables separated by blank rows are independent regions", () => {
  const rows = [...inventoryRows, [], [], ["Unit Number", "Unit Type", "BUA", "Price"], ["B-1", "Office", 85, 8_000_000], ["B-2", "Office", 90, 9_000_000]];
  const sheet = analyzeWorkbook(workbook([{ name: "Mixed", rows }]), "two-tables.xlsx").sheets[0];
  assert.ok(sheet.candidateTables.length >= 2);
  assert.notEqual(sheet.candidateTables[0].headerRow, sheet.candidateTables[1].headerRow);
});

test("J: multiple inventory sheets are classified independently and flagged", () => {
  const result = analyzeWorkbook(workbook([{ name: "Project A", rows: inventoryRows }, { name: "Project B", rows: inventoryRows.map((row) => [...row]) }]), "multi-project.xlsx");
  assert.equal(result.inventorySheetCount, 2);
  assert.ok(result.warnings.includes("MULTIPLE_INVENTORY_SHEETS"));
});

test("K/L/M: Arabic, English and mixed headers map semantically", () => {
  const result = analyzeWorkbook(workbook([
    { name: "Arabic", rows: [["رقم الوحدة", "نوع الوحدة", "المساحة", "السعر"], ["أ-1", "شقة", 120, 9_000_000]] },
    { name: "English", rows: inventoryRows },
    { name: "Mixed", rows: [["Unit No", "النوع", "BUA", "السعر"], ["M-1", "Apartment", 100, 8_000_000]] },
  ]), "languages.xlsx");
  for (const sheet of result.sheets) {
    const fields = sheet.candidateTables[0].columns.map((column) => column.semanticField);
    assert.ok(fields.includes("externalUnitId")); assert.ok(fields.includes("price"));
  }
});

test("N/P: totals are excluded while duplicate source identifiers remain auditable", () => {
  const book = workbook([{ name: "Inventory", rows: [inventoryRows[0], inventoryRows[1], inventoryRows[1], ["Grand Total", null, null, 20_000_000]] }]);
  const analysis = analyzeWorkbook(book, "totals.xlsx");
  const rows = recordsForTable(book, analysis.sheets[0].candidateTables[0]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["Unit Number"], rows[1]["Unit Number"]);
});

test("Q: invalid price/date source values are preserved for server validation", () => {
  const book = workbook([{ name: "Inventory", rows: [["Unit Number", "Price", "Delivery Date"], ["A-1", "not-a-price", "32/99/2028"]] }]);
  const analysis = analyzeWorkbook(book, "invalid.xlsx");
  const rows = recordsForTable(book, analysis.sheets[0].candidateTables[0]);
  assert.equal(rows[0].Price, "not-a-price");
  assert.equal(rows[0]["Delivery Date"], "32/99/2028");
});

test("R: low-confidence unknown table requires manual header review", () => {
  const result = analyzeWorkbook(workbook([{ name: "Sheet1", rows: [["Alpha", "Beta", "Gamma"], ["x", 1, "z"], ["y", 2, "q"]] }]), "ambiguous.xlsx");
  const table = result.sheets[0].candidateTables[0];
  assert.ok(table.confidence < 65);
  assert.ok(table.warnings.includes("HEADER_REVIEW_REQUIRED"));
});

test("S/T: summary and unstructured sheets do not become inventory", () => {
  const result = analyzeWorkbook(workbook([{ name: "Summary", rows: [["Project", "XYZ"], ["Developer", "ABC"], ["Total", 20]] }, { name: "Sheet4", rows: [["free form note"], [], [123]] }]), "no-inventory.xlsx");
  assert.equal(result.inventorySheetCount, 0);
  assert.ok(result.warnings.includes("NO_INVENTORY_SHEET"));
  assert.notEqual(result.sheets[0].classification, "INVENTORY");
  assert.equal(result.sheets[1].classification, "UNKNOWN");
});

test("manual header override rebuilds records from the selected row", () => {
  const book = workbook([{ name: "Data", rows: [["Title"], [], ["Unit Number", "Price"], ["A-1", 1_000_000]] }]);
  const table = detectTableAt(rawSheetMatrix(book.Sheets.Data), "Data", 3, 1)!;
  assert.deepEqual(recordsForTable(book, table), [{ "Unit Number": "A-1", Price: 1_000_000 }]);
});
