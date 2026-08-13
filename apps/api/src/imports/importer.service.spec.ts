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
    project: { findUnique: async () => ({ id: "project-1", developerId: "developer-1", locationId: "location-1", developer: { slug: "developer-one" } }) },
    developer: { findUnique: async () => ({ id: "developer-1", slug: "developer-one" }) },
    location: { findUnique: async () => ({ id: "location-1" }) },
    importMapping: { findMany: async () => [] },
    importValueMapping: { findMany: async () => [] },
    unit: { findMany: async () => [] },
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
      updateMany: async ({ where, data }: any) => {
        for (const issue of issues)
          if (issue.importId === where.importId && (where.field?.in ? where.field.in.includes(issue.field) : issue.field === where.field)) Object.assign(issue, data);
        return { count: issues.length };
      },
      deleteMany: async () => ({ count: 0 }),
      create: async ({ data }: any) => { const issue = { id: `issue-${issues.length}`, resolvedAt: null, ...data }; issues.push(issue); return issue; },
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
  assert.ok(result.issues.some((issue: any) => issue.field === "projectId"));
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

test("real workbook shape produces typed selectors and an 8-year payment plan", async () => {
  const f = fixture();
  const rows = Array.from({ length: 16 }, (_, index) => ({
    "Properties Unit no.": `C51 4/${index + 1}`,
    "Properties Delivery Date": "28-02-2027",
    "Properties Standard Unit Price": 13_578_000 + index,
    "Properties Unit Price 8 Y": 13_578_000 + index,
    "Properties Finishing": "Semi-Finished",
    "Properties Total Gross Area": 165,
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Inventory");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
  const result: any = await f.service.analyze(file(buffer), {});
  assert.equal(result.rowsDetected, 16);
  assert.equal(result.analysis.mappings["Properties Unit no."], "externalUnitId");
  assert.equal(result.analysis.mappings["Properties Standard Unit Price"], "price");
  assert.equal(result.analysis.mappings["Properties Total Gross Area"], "builtUpArea");
  assert.equal(result.analysis.paymentPlanMappings["Properties Unit Price 8 Y"].durationMonths, 96);
  assert.equal(result.issues.find((issue: any) => issue.field === "projectId")?.inputType, "PROJECT_SELECT");
  assert.equal(result.issues.find((issue: any) => issue.field === "developerId")?.inputType, "DEVELOPER_SELECT");
  assert.equal(result.issues.find((issue: any) => issue.field === "locationId")?.inputType, "LOCATION_SELECT");
  assert.equal(result.issues.find((issue: any) => issue.field === "currency")?.inputType, "CURRENCY_SELECT");
  const planIssue = result.issues.find((issue: any) => issue.field === "paymentPlan:Properties Unit Price 8 Y");
  assert.equal(planIssue.inputType, "PAYMENT_PLAN_MAPPING");
  assert.equal(planIssue.options.suggestedDurationMonths, 96);
});

test("multiple plan columns stay on one unit and preserve the official price", () => {
  const f = fixture();
  const analysis: any = { sheetName: "Inventory", mappings: { "Unit No": "externalUnitId", "Standard Price": "price" }, paymentPlanMappings: { "Price 5 Y": { durationMonths: 60, valueType: "TOTAL_PRICE", sourceDurationText: "5 Y", approved: true }, "Price 8 Y": { durationMonths: 96, valueType: "TOTAL_PRICE", sourceDurationText: "8 Y", approved: true }, "Price 10 Y": { durationMonths: 120, valueType: "TOTAL_PRICE", sourceDurationText: "10 Y", approved: true } }, valueMappings: {}, defaultValues: { currency: "EGP" } };
  const row = { "Unit No": "A-1", "Standard Price": 10_000_000, "Price 5 Y": 11_000_000, "Price 8 Y": 12_000_000, "Price 10 Y": 13_000_000 };
  const values = (f.service as any).valuesForRow(row, analysis);
  const plans = (f.service as any).paymentPlansForRow(row, analysis, 2, "import-1", "plans.xlsx");
  assert.equal(values.price, 10_000_000);
  assert.deepEqual(plans.map((plan: any) => plan.durationMonths), [60, 96, 120]);
  assert.deepEqual(plans.map((plan: any) => plan.totalPrice), [11_000_000, 12_000_000, 13_000_000]);
});

test("selecting a newly created project returns to the same import and resolves relations", async () => {
  const f = fixture();
  const uploaded: any = await f.service.analyze(file(workbookBuffer({ "Unit Number": "RETURN-1", Currency: "EGP" })), {});
  const returned: any = await f.service.resolve(uploaded.id, "projectId", "project-1");
  assert.equal(returned.id, uploaded.id);
  assert.equal(returned.analysis.metadata.projectId, "project-1");
  assert.equal(returned.analysis.metadata.developerId, "developer-1");
  assert.equal(returned.analysis.metadata.locationId, "location-1");
  assert.ok(returned.issues.find((issue: any) => issue.field === "projectId").resolvedAt);
  assert.ok(returned.issues.find((issue: any) => issue.field === "developerId").resolvedAt);
  assert.ok(returned.issues.find((issue: any) => issue.field === "locationId").resolvedAt);
});

test("preview and confirm share typed normalization and reject an invalid date before writes", async () => {
  const f = fixture();
  const uploaded: any = await f.service.analyze(file(workbookBuffer({ "Unit Number": "BAD-DATE", Currency: "EGP", "Delivery Date": "31-02-2027" })), { projectId: "project-1", developerId: "developer-1", locationId: "location-1" });
  const preview: any = await f.service.preview(uploaded.id);
  assert.equal(preview.preview.invalidRows, 1);
  assert.equal(preview.preview.canConfirm, false);
  await assert.rejects(() => f.service.confirm(uploaded.id), (error: any) => error.getResponse().code === "IMPORT_PREVIEW_REQUIRED");
});
