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
