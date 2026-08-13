import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { StorageProviderError } from "../storage/storage.service";
import { ImporterService } from "./importer.service";

function workbookBuffer(row: Record<string, unknown>, secondSheet = false) {
  const workbook = XLSX.utils.book_new();
  if (secondSheet)
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.json_to_sheet([row]),
    "Inventory",
  );
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
}

function file(buffer: Buffer, name = "inventory.xlsx"): Express.Multer.File {
  return {
    buffer,
    originalname: name,
    mimetype: "application/octet-stream",
    size: buffer.length,
  } as Express.Multer.File;
}

function fixture(options: { aiFails?: boolean; storageFails?: boolean } = {}) {
  const events: string[] = [];
  const issues: any[] = [];
  let record: any;
  const prisma: any = {
    importMapping: { findMany: async () => [] },
    importValueMapping: { findMany: async () => [] },
    dataImport: {
      create: async ({ data }: any) => {
        events.push("database-create");
        record = {
          id: "import-1",
          rowsCreated: 0,
          rowsUpdated: 0,
          rowsRejected: 0,
          ...data,
        };
        return record;
      },
      update: async ({ data }: any) => {
        record = { ...record, ...data };
        return record;
      },
      findUnique: async () => ({
        ...record,
        issues,
        developer: null,
        project: null,
      }),
    },
    importIssue: {
      createMany: async ({ data }: any) => {
        issues.push(
          ...data.map((issue: any, index: number) => ({
            id: `issue-${issues.length + index}`,
            resolvedAt: null,
            ...issue,
          })),
        );
      },
    },
    $transaction: async (callback: any) => {
      events.push("transaction");
      return typeof callback === "function" ? callback(prisma) : Promise.all(callback);
    },
  };
  const storage: any = {
    put: async () => {
      events.push("storage");
      if (options.storageFails)
        throw new StorageProviderError("AUTH", 403, new Error("denied"));
      return { key: "imports/source.xlsx", url: "https://assets/source.xlsx" };
    },
  };
  const ai: any = {
    mapColumns: async () => {
      events.push("ai");
      if (options.aiFails)
        throw Object.assign(new Error("AI unavailable"), { status: 503 });
      return [];
    },
  };
  return {
    service: new ImporterService(prisma, storage, ai),
    events,
    issues,
    record: () => record,
  };
}

test("raw upload survives unavailable AI and creates manual mapping issues", async () => {
  const f = fixture({ aiFails: true });
  const result: any = await f.service.analyze(
    file(
      workbookBuffer({
        "Unit Number": "A-101",
        Price: 9_000_000,
        "Unknown Sales Label": "Garden view",
      }),
    ),
    {},
    { requestId: "request-1", adminUserId: "admin-1" },
  );

  assert.equal(result.status, "NEEDS_INPUT");
  assert.equal(result.fileUrl, "https://assets/source.xlsx");
  assert.equal(result.analysis.aiMapping.status, "UNAVAILABLE");
  assert.ok(result.issues.some((issue: any) => issue.field === "aiMapping"));
  assert.ok(
    result.issues.some(
      (issue: any) => issue.field === "column:Unknown Sales Label",
    ),
  );
  assert.ok(result.issues.some((issue: any) => issue.field === "projectName"));
  assert.deepEqual(f.events, ["database-create", "storage", "ai", "transaction"]);
});

test("multiple worksheets select the first usable inventory sheet", async () => {
  const f = fixture();
  const result: any = await f.service.analyze(
    file(workbookBuffer({ "Unit Number": "A-102", Currency: "EGP" }, true)),
    {},
  );
  assert.equal(result.analysis.sheetName, "Inventory");
  assert.equal(result.rowsDetected, 1);
});

test("empty workbook returns a structured 422 validation error", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), "Empty");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const f = fixture();
  await assert.rejects(
    () => f.service.analyze(file(buffer), {}),
    (error: any) => {
      assert.equal(error.getStatus(), 422);
      assert.equal(error.getResponse().code, "IMPORT_NO_USABLE_SHEETS");
      return true;
    },
  );
});

test("storage failures leave a traceable FAILED import with a safe code", async () => {
  const f = fixture({ storageFails: true });
  await assert.rejects(
    () =>
      f.service.analyze(
        file(workbookBuffer({ "Unit Number": "A-103" })),
        {},
      ),
    (error: any) => {
      assert.equal(error.getStatus(), 503);
      assert.equal(error.getResponse().code, "IMPORT_STORAGE_AUTH_FAILED");
      assert.equal(error.getResponse().importId, "import-1");
      return true;
    },
  );
  assert.equal(f.record().status, "FAILED");
  assert.equal(f.record().warnings.code, "IMPORT_STORAGE_AUTH_FAILED");
});

test("preview becomes ready only after blocking questions are resolved", async () => {
  const f = fixture({ aiFails: true });
  await f.service.analyze(
    file(workbookBuffer({ "Unit Number": "A-104", Currency: "EGP" })),
    {},
  );
  for (const issue of f.issues) issue.resolvedAt = new Date();
  const preview: any = await f.service.preview("import-1");
  assert.equal(preview.preview.canConfirm, true);
  assert.equal(preview.preview.valid, 1);
  assert.equal(f.record().status, "READY");
});
