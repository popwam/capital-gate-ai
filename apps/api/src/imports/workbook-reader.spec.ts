import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { readImportWorkbook } from "./workbook-reader";

const arabicRow = { "رقم الوحدة": "أ-١٠١", المشروع: "القاهرة الجديدة" };

function firstRow(workbook: XLSX.WorkBook) {
  return XLSX.utils.sheet_to_json<Record<string, string>>(
    workbook.Sheets[workbook.SheetNames[0]],
  )[0];
}

test("UTF-8 CSV preserves Arabic headers and values", () => {
  const csv = Buffer.from("رقم الوحدة,المشروع\nأ-١٠١,القاهرة الجديدة\n", "utf8");
  assert.deepEqual(firstRow(readImportWorkbook(csv, "units.csv")), arabicRow);
});

for (const bookType of ["xlsx", "biff8"] as const) {
  test(`${bookType} workbook preserves Arabic values`, () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.json_to_sheet([arabicRow]),
      "الوحدات",
    );
    const buffer = XLSX.write(workbook, { type: "buffer", bookType });
    const extension = bookType === "xlsx" ? ".xlsx" : ".xls";
    assert.deepEqual(firstRow(readImportWorkbook(buffer, `units${extension}`)), arabicRow);
  });
}

test("legacy or malformed CSV bytes are rejected instead of corrupted", () => {
  assert.throws(
    () => readImportWorkbook(Buffer.from([0x80, 0x81, 0x82]), "units.csv"),
    /must be valid UTF-8/,
  );
});

test("XLSX keeps formulas, dates, merged cells and ignores empty rows", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Unit Number", "Price", "Delivery Date", "Notes", null],
    ["A-201", 9_000_000, new Date("2028-06-01T00:00:00.000Z"), "Ready", null],
    [],
  ], { cellDates: true });
  sheet.B2 = { t: "n", f: "4500000*2", v: 9_000_000 };
  sheet["!merges"] = [XLSX.utils.decode_range("D1:E1")];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Inventory");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const parsed = readImportWorkbook(buffer, "inventory.xlsx");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    parsed.Sheets.Inventory,
    { raw: true },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0]["Unit Number"], "A-201");
  assert.equal(rows[0].Price, 9_000_000);
  assert.ok(rows[0]["Delivery Date"] instanceof Date);
});
