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

function fixture(options: { aiFails?: boolean; storageFails?: boolean; rememberedMappings?: any[] } = {}) {
  const events: string[] = [];
  const issues: any[] = [];
  let record: any;
  const prisma: any = {
    project: { findUnique: async () => ({ id: "project-1", developerId: "developer-1", locationId: "location-1", developer: { slug: "developer-one" } }) },
    developer: { findUnique: async () => ({ id: "developer-1", slug: "developer-one" }) },
    location: { findUnique: async () => ({ id: "location-1" }) },
    importMapping: { findMany: async () => options.rememberedMappings ?? [], upsert: async () => ({}) },
    importValueMapping: { findMany: async () => [], upsert: async () => ({}) },
    unit: {
      findMany: async () => [],
      findUnique: async () => null,
      findUniqueOrThrow: async ({ where }: any) => ({ id: where.id, externalUnitId: "READY-1", paymentPlans: [], offers: [] }),
      create: async ({ data }: any) => ({ id: "unit-1", ...data }),
      update: async ({ data }: any) => ({ id: "unit-1", ...data }),
      count: async () => 0,
    },
    paymentPlan: { count: async () => 0, updateMany: async () => ({ count: 0 }), create: async () => ({}) },
    offer: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
    unitPriceHistory: { create: async () => ({}) },
    importUnitChange: { create: async () => ({}) },
    media: { count: async () => 0 },
    document: { count: async () => 0 },
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
        unitChanges: [],
        developer: null,
        project: null,
      }),
      count: async () => 0,
      delete: async () => { record = undefined; return { id: "import-1" }; },
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
    delete: async () => { events.push("storage-delete"); },
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

test("Admin-approved memory auto-applies the same critical mapping without asking again", async () => {
  const f = fixture({ rememberedMappings: [{ developerSlug: "developer-one", normalizedColumn: "properties standard unit price", canonicalField: "price", approved: true }] });
  const result: any = await f.service.analyze(file(workbookBuffer({ "Unit Number": "A-102M", "Properties Standard Unit Price": 9_000_000, Currency: "EGP" })), { projectId: "project-1" });
  assert.equal(result.analysis.mappingSources["Properties Standard Unit Price"], "ADMIN_APPROVED_MEMORY");
  assert.equal(result.issues.some((issue: any) => issue.field === "column:Properties Standard Unit Price"), false);
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
    { projectId: "project-1", developerId: "developer-1", locationId: "location-1" },
  );
  for (const issue of f.issues) issue.resolvedAt = new Date();
  const preview: any = await f.service.preview("import-1");
  assert.equal(preview.preview.canConfirm, true);
  assert.equal(preview.preview.valid, 1);
  assert.equal(f.record().status, "READY");
});

test("readiness counts only unresolved blocking issues and warnings never block preview", () => {
  const f = fixture();
  const readiness = (f.service as any).getImportReadiness({
    status: "NEEDS_INPUT",
    developerId: "developer-1",
    projectId: "project-1",
    preview: null,
    analysis: {
      selectedTable: { id: "table-1" },
      mappings: { Unit: "externalUnitId", Currency: "currency" },
      metadata: { locationId: "location-1" },
      defaultValues: {},
    },
    issues: [
      { severity: "BLOCKING", resolvedAt: null },
      { severity: "BLOCKING", resolvedAt: new Date() },
      { severity: "WARNING", resolvedAt: null },
      { severity: "WARNING", resolvedAt: new Date() },
      { severity: "INFO", resolvedAt: null },
      { severity: "ERROR", resolvedAt: null, required: true },
    ],
  });
  assert.equal(readiness.unresolvedBlockingCount, 2);
  assert.equal(readiness.unresolvedWarningCount, 1);
  assert.equal(readiness.canPreview, false);

  const warningOnly = (f.service as any).getImportReadiness({
    status: "NEEDS_INPUT",
    developerId: "developer-1",
    projectId: "project-1",
    preview: null,
    analysis: {
      selectedTable: { id: "table-1" },
      mappings: { Unit: "externalUnitId", Currency: "currency" },
      metadata: { locationId: "location-1" },
      defaultValues: {},
    },
    issues: [{ severity: "WARNING", resolvedAt: null }],
  });
  assert.equal(warningOnly.canPreview, true);
  assert.equal(warningOnly.stage, "PREVIEW");
});

test("three persisted issue resolutions unlock preview and reload preserves the stage", async () => {
  const f = fixture();
  await f.service.analyze(
    file(workbookBuffer({ "Unit Number": "READY-1", Currency: "EGP" })),
    { projectId: "project-1", developerId: "developer-1", locationId: "location-1" },
  );
  f.issues.splice(0, f.issues.length,
    ...["decision:a", "decision:b", "decision:c"].map((field, index) => ({
      id: `blocking-${index}`,
      importId: "import-1",
      field,
      severity: "BLOCKING",
      resolvedAt: null,
    })),
  );
  f.record().analysis.metadata = {
    projectId: "project-1",
    developerId: "developer-1",
    locationId: "location-1",
  };
  f.record().projectId = "project-1";
  f.record().developerId = "developer-1";

  for (const [index, field] of ["decision:a", "decision:b", "decision:c"].entries()) {
    const result: any = await f.service.resolve("import-1", field, "APPROVED");
    assert.equal(result.workflow.unresolvedBlockingCount, 2 - index);
    assert.equal(result.workflow.canPreview, index === 2);
  }
  const reloaded: any = await f.service.get("import-1");
  assert.equal(reloaded.status, "READY");
  assert.equal(reloaded.workflow.stage, "PREVIEW");
  assert.equal(reloaded.workflow.previewExists, false);

  const preview: any = await f.service.preview("import-1");
  assert.equal(preview.workflow.canConfirm, true);
  assert.equal(preview.workflow.stage, "IMPORT");

  const confirmed: any = await f.service.confirm("import-1");
  assert.equal(confirmed.import.status, "COMPLETED");
  assert.equal(confirmed.import.workflow.stage, "COMPLETE");
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
  for (const column of ["Properties Unit no.", "Properties Delivery Date", "Properties Standard Unit Price", "Properties Finishing", "Properties Total Gross Area"]) {
    const confirmation = result.issues.find((issue: any) => issue.field === `column:${column}`);
    assert.equal(confirmation?.inputType, "CANONICAL_FIELD_SELECT", column);
    assert.equal(confirmation?.options?.suggestedValue, result.analysis.mappings[column], column);
    assert.equal(confirmation?.required, true, column);
  }
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
  for (const mappingIssue of uploaded.issues.filter((issue: any) => issue.field?.startsWith("column:") && issue.options?.suggestedValue))
    await f.service.resolve(uploaded.id, mappingIssue.field, mappingIssue.options.suggestedValue);
  const preview: any = await f.service.preview(uploaded.id);
  assert.equal(preview.preview.invalidRows, 1);
  assert.equal(preview.preview.canConfirm, false);
  await assert.rejects(() => f.service.confirm(uploaded.id), (error: any) => error.getResponse().code === "IMPORT_PREVIEW_REQUIRED");
});

test("unfinished import deletion removes only an exclusively-owned source object", async () => {
  const f = fixture({ aiFails: true });
  await f.service.analyze(file(workbookBuffer({ "Unit Number": "CLEANUP-1" })), {});
  const result: any = await f.service.removeBatch("import-1", "DELETE_UNFINISHED");
  assert.equal(result.deleted, true);
  assert.equal(result.sourceObjectDeleted, true);
  assert.equal(result.storageCleanupFailed, false);
  assert.equal(f.record(), undefined);
  assert.ok(f.events.includes("storage-delete"));
});
