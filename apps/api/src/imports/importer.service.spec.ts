import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import { Prisma } from "@prisma/client";
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
  const importSheets: any[] = [];
  const units: any[] = [];
  const unitChanges:any[]=[];
  const corrections:any[]=[];
  const correctionChanges:any[]=[];
  let paymentPlansCreated = 0;
  let record: any;
  let storedBuffer: Buffer | undefined;
  const prisma: any = {
    project: { findUnique: async ({where}:any={where:{id:"project-1"}}) => ({ id: where.id, developerId: where.id==="project-2"?"developer-2":"developer-1", locationId: where.id==="project-2"?"location-2":"location-1", developer: { slug: where.id==="project-2"?"developer-two":"developer-one" } }) },
    developer: { findUnique: async ({where}:any={where:{id:"developer-1"}}) => ({ id: where.id, slug: where.id==="developer-2"?"developer-two":"developer-one" }) },
    location: { findUnique: async () => ({ id: "location-1" }) },
    importMapping: { findMany: async () => options.rememberedMappings ?? [], upsert: async () => ({}) },
    importValueMapping: { findMany: async () => [], upsert: async () => ({}) },
    unit: {
      findMany: async () => [],
      findUnique: async ({where}:any) => units.find(unit=>unit.developerId===where.developerId_projectId_externalUnitId?.developerId&&unit.projectId===where.developerId_projectId_externalUnitId?.projectId&&unit.externalUnitId===where.developerId_projectId_externalUnitId?.externalUnitId)??null,
      findUniqueOrThrow: async ({ where }: any) => ({ ...(units.find(unit=>unit.id===where.id)??{id:where.id,externalUnitId:"READY-1"}), paymentPlans: [], offers: [] }),
      create: async ({ data }: any) => {const value={id:`unit-${units.length+1}`,...data};units.push(value);return value;},
      update: async ({where,data}:any) => {const value=units.find(unit=>unit.id===where.id);Object.assign(value,data);return value;},
      count: async () => 0,
    },
    paymentPlan: { count: async () => 0, updateMany: async () => ({ count: 0 }), create: async () => {paymentPlansCreated++;return {};} },
    offer: { updateMany: async () => ({ count: 0 }), create: async () => ({}) },
    unitPriceHistory: { create: async () => ({}) },
    importUnitChange: { create: async ({data}:any) => {const value={id:`change-${unitChanges.length+1}`,...data};unitChanges.push(value);return value;}, findMany:async ({where}:any)=>unitChanges.filter(change=>change.importId===where.importId&&change.importSheetId===where.importSheetId).map(change=>({...change,unit:units.find(unit=>unit.id===change.unitId)})) },
    importCorrection:{create:async ({data}:any)=>{const value={id:`correction-${corrections.length+1}`,status:"DRAFT",preview:null,conflictDecisions:null,...data};corrections.push(value);return value;},findFirst:async ({where,include}:any)=>{const value=corrections.find(correction=>correction.id===where.id&&correction.importId===where.importId);if(!value)return null;return {...value,...(include?.import?{import:record}:{}),...(include?.importSheet?{importSheet:importSheets.find(sheet=>sheet.id===value.importSheetId)}:{}),...(include?.changes?{changes:correctionChanges.filter(change=>change.correctionId===value.id)}:{})};},update:async ({where,data}:any)=>{const value=corrections.find(correction=>correction.id===where.id);Object.assign(value,data);return value;}},
    importCorrectionChange:{deleteMany:async ({where}:any)=>{for(let i=correctionChanges.length-1;i>=0;i--)if(correctionChanges[i].correctionId===where.correctionId)correctionChanges.splice(i,1);return {count:0};},create:async ({data}:any)=>{const value={id:`correction-change-${correctionChanges.length+1}`,decision:null,appliedAt:null,...data};correctionChanges.push(value);return value;},update:async ({where,data}:any)=>{const value=correctionChanges.find(change=>change.id===where.id);Object.assign(value,data);return value;}},
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
        record = { ...record, ...Object.fromEntries(Object.entries(data).map(([key,value])=>[key,value===Prisma.DbNull?null:value])) };
        return record;
      },
      findUnique: async () => ({
        ...record,
        issues,
        sheets: importSheets,
        corrections: [],
        unitChanges: [],
        developer: null,
        project: null,
      }),
      findUniqueOrThrow: async () => ({ ...record, issues, sheets: importSheets, corrections: [] }),
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
      deleteMany: async ({ where }: any = {}) => { const before=issues.length;for(let i=issues.length-1;i>=0;i--)if((!where?.importId||issues[i].importId===where.importId)&&(!where?.field?.startsWith||String(issues[i].field||"").startsWith(where.field.startsWith)))issues.splice(i,1);return {count:before-issues.length}; },
      create: async ({ data }: any) => { const issue = { id: `issue-${issues.length}`, resolvedAt: null, ...data }; issues.push(issue); return issue; },
    },
    importSheet: {
      create: async ({ data }: any) => { const value={id:`sheet-${importSheets.length+1}`,mappingVersion:1,previewMappingVersion:null,rowsCreated:0,rowsUpdated:0,...data};importSheets.push(value);return value; },
      findUniqueOrThrow: async ({where}:any) => { const value=importSheets.find(sheet=>sheet.id===where.id);if(!value)throw new Error("missing sheet");return value; },
      findFirst: async ({where}:any) => importSheets.find(sheet=>sheet.id===where.id&&sheet.importId===where.importId)??null,
      findMany: async ({where}:any) => importSheets.filter(sheet=>sheet.importId===where.importId&&sheet.action===where.action).map(sheet=>({id:sheet.id})),
      update: async ({where,data}:any) => { const value=importSheets.find(sheet=>sheet.id===where.id);for(const [key,next] of Object.entries(data)){if(next&&typeof next==="object"&&"increment" in next)(value as any)[key]=((value as any)[key]||0)+(next as any).increment;else (value as any)[key]=next===Prisma.DbNull?null:next;}return value; },
    },
    $transaction: async (callback: any) => {
      events.push("transaction");
      return typeof callback === "function" ? callback(prisma) : Promise.all(callback);
    },
  };
  const storage: any = {
    put: async (buffer: Buffer) => {
      events.push("storage");
      if (options.storageFails)
        throw new StorageProviderError("AUTH", 403, new Error("denied"));
      storedBuffer = buffer;
      return { key: "imports/source.xlsx", url: "https://assets/source.xlsx" };
    },
    get: async () => storedBuffer!,
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
    importSheets,
    units,
    unitChanges,
    paymentPlansCreated: () => paymentPlansCreated,
    record: () => record,
  };
}

test("raw upload is deterministic, does not depend on AI, and scopes issues to selected sheets", async () => {
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
  assert.ok(
    result.issues.some(
      (issue: any) => issue.field.endsWith(":column:Unknown Sales Label"),
    ),
  );
  assert.ok(result.issues.some((issue: any) => issue.field.endsWith(":projectId")));
  assert.equal(result.sheets.length, 1);
  assert.equal(result.sheets[0].action, "IMPORT");
  assert.equal(f.events.includes("ai"), false);
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
  assert.equal(result.sheets[0].mappings["Properties Standard Unit Price"], "price");
  assert.equal(result.sheets[0].mappingSources["Properties Standard Unit Price"], "ADMIN_APPROVED_MEMORY");
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

test("real workbook shape keeps payment-plan price columns out of automatic plan ingestion", async () => {
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
  const sheet = result.sheets[0];
  assert.equal(sheet.rowsDetected, 16);
  assert.equal(sheet.mappings["Properties Unit no."], "externalUnitId");
  assert.equal(sheet.mappings["Properties Standard Unit Price"], "price");
  assert.equal(sheet.mappings["Properties Total Gross Area"], "builtUpArea");
  assert.equal(sheet.mappings["Properties Unit Price 8 Y"], undefined);
  assert.ok(result.issues.some((issue:any)=>issue.field.endsWith(":column:Properties Unit Price 8 Y")));
});

test("automatic payment-plan record generation is disabled", () => {
  const f = fixture();
  const analysis: any = { sheetName: "Inventory", mappings: { "Unit No": "externalUnitId", "Standard Price": "price" }, paymentPlanMappings: { "Price 5 Y": { durationMonths: 60, valueType: "TOTAL_PRICE", sourceDurationText: "5 Y", approved: true }, "Price 8 Y": { durationMonths: 96, valueType: "TOTAL_PRICE", sourceDurationText: "8 Y", approved: true }, "Price 10 Y": { durationMonths: 120, valueType: "TOTAL_PRICE", sourceDurationText: "10 Y", approved: true } }, valueMappings: {}, defaultValues: { currency: "EGP" } };
  const row = { "Unit No": "A-1", "Standard Price": 10_000_000, "Price 5 Y": 11_000_000, "Price 8 Y": 12_000_000, "Price 10 Y": 13_000_000 };
  const values = (f.service as any).valuesForRow(row, analysis);
  assert.equal(values.price, 10_000_000);
  assert.equal((f.service as any).sheetValueErrors(values).length, 0);
});

test("selecting a newly created project returns to the same import and resolves relations", async () => {
  const f = fixture();
  const uploaded: any = await f.service.analyze(file(workbookBuffer({ "Unit Number": "RETURN-1", Currency: "EGP" })), {});
  const returned: any = await f.service.updateImportSheet(uploaded.id, uploaded.sheets[0].id, { projectId: "project-1", defaultCurrency: "EGP" });
  assert.equal(returned.id, uploaded.id);
  assert.equal(returned.sheets[0].projectId, "project-1");
  assert.equal(returned.sheets[0].developerId, "developer-1");
  assert.equal(returned.sheets[0].locationId, "location-1");
  assert.equal(returned.issues.some((issue:any)=>issue.field.endsWith(":projectId")),false);
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

test("Admin sheet selection imports only Villas and ignores payment, summary, notes and Apartments", async () => {
  const workbook = XLSX.utils.book_new();
  const inventory = (code:string,type:string) => XLSX.utils.json_to_sheet([{ "Unit Code":code, Type:type, Price:10_000_000, Currency:"EGP" }]);
  XLSX.utils.book_append_sheet(workbook, inventory("V-1","Villa"), "Villas");
  XLSX.utils.book_append_sheet(workbook, inventory("A-1","Apartment"), "Apartments");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Payment Plan","8 Years"],["Down Payment",10]]), "Payment Plan");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Total No. of units",2],["Total Price Of Units",20_000_000]]), "Summary");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Notes"],["Availability subject to confirmation"]]), "Notes");
  const buffer = XLSX.write(workbook,{type:"buffer",bookType:"xlsx"});
  const f=fixture();
  let result:any=await f.service.analyze(file(buffer,"portfolio.xlsx"),{projectId:"project-1",developerId:"developer-1",locationId:"location-1"});
  const villas=result.sheets.find((sheet:any)=>sheet.sheetName==="Villas"&&sheet.action==="IMPORT");
  const apartments=result.sheets.find((sheet:any)=>sheet.sheetName==="Apartments"&&sheet.action==="IMPORT");
  assert.ok(villas);
  assert.ok(apartments);
  assert.equal(result.sheets.find((sheet:any)=>sheet.sheetName==="Payment Plan").action,"IGNORE");
  assert.equal(result.sheets.find((sheet:any)=>sheet.sheetName==="Summary").action,"IGNORE");
  assert.equal(result.sheets.find((sheet:any)=>sheet.sheetName==="Notes").action,"IGNORE");
  result=await f.service.updateImportSheet(result.id,apartments.id,{action:"IGNORE"});
  assert.equal(result.issues.some((issue:any)=>issue.field?.startsWith(`sheet:${apartments.id}:`)),false);
  result=await f.service.preview(result.id);
  assert.equal(result.preview.selectedSheetCount,1);
  assert.equal(result.preview.sheets[0].sheetName,"Villas");
  const confirmed:any=await f.service.confirm(result.id);
  assert.equal(confirmed.result.created,1);
  assert.equal(f.units.length,1);
  assert.equal(f.units[0].externalUnitId,"V-1");
  assert.notEqual(f.units[0].unitType,"Apartment");
  assert.equal(f.paymentPlansCreated(),0);
});

test("selected sheets preserve independent project and unit-type context", async () => {
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Code:"V-2",Type:"Villa",Currency:"EGP"}]),"Villas");
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Code:"C-2",Type:"Clinic",Currency:"EGP"}]),"Clinics");
  const f=fixture();
  let result:any=await f.service.analyze(file(XLSX.write(workbook,{type:"buffer",bookType:"xlsx"}),"multi-project.xlsx"),{});
  const villas=result.sheets.find((sheet:any)=>sheet.sheetName==="Villas"&&sheet.action==="IMPORT");
  const clinics=result.sheets.find((sheet:any)=>sheet.sheetName==="Clinics"&&sheet.action==="IMPORT");
  result=await f.service.updateImportSheet(result.id,villas.id,{projectId:"project-1",defaultCurrency:"EGP",defaultUnitType:"VILLA"});
  result=await f.service.updateImportSheet(result.id,clinics.id,{projectId:"project-2",defaultCurrency:"EGP",defaultUnitType:"CLINIC"});
  assert.equal(result.sheets.find((sheet:any)=>sheet.id===villas.id).projectId,"project-1");
  assert.equal(result.sheets.find((sheet:any)=>sheet.id===clinics.id).projectId,"project-2");
  assert.match(result.sheets.find((sheet:any)=>sheet.id===villas.id).defaultUnitType,/Villa/i);
  assert.match(result.sheets.find((sheet:any)=>sheet.id===clinics.id).defaultUnitType,/Clinic/i);
  assert.equal(result.sheets.some((sheet:any)=>/Apartment/i.test(sheet.defaultUnitType||"")),false);
});

test("editing a mapping invalidates preview and confirmation uses the reviewed replacement", async () => {
  const f=fixture();
  let result:any=await f.service.analyze(file(workbookBuffer({"Unit Number":"MAP-1",Currency:"EGP","Land Area":320})),{projectId:"project-1",developerId:"developer-1",locationId:"location-1"});
  const sheet=result.sheets[0];
  result=await f.service.preview(result.id);
  assert.equal(result.workflow.canConfirm,true);
  const previewVersion=result.sheets[0].previewMappingVersion;
  result=await f.service.updateImportSheetMapping(result.id,sheet.id,"Land Area","builtUpArea");
  assert.equal(result.preview,null);
  assert.equal(result.sheets[0].previewMappingVersion,null);
  assert.ok(result.sheets[0].mappingVersion>previewVersion);
  await assert.rejects(()=>f.service.confirm(result.id),(error:any)=>error.getResponse().code==="IMPORT_PREVIEW_REQUIRED");
  result=await f.service.preview(result.id);
  const confirmed:any=await f.service.confirm(result.id);
  assert.equal(confirmed.import.status,"COMPLETED");
  assert.equal(f.units[0].builtUpArea,320);
  assert.equal(f.units[0].landArea,undefined);
});

test("post-confirm correction previews changes and protects a later manual edit", async () => {
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet([{Code:"COR-1",Currency:"EGP","Land Area":300},{Code:"COR-2",Currency:"EGP","Land Area":350}]),"Inventory");
  const f=fixture();
  let result:any=await f.service.analyze(file(XLSX.write(workbook,{type:"buffer",bookType:"xlsx"}),"correction.xlsx"),{projectId:"project-1",developerId:"developer-1",locationId:"location-1"});
  result=await f.service.preview(result.id);
  result=(await f.service.confirm(result.id)).import;
  assert.equal(f.units.length,2);
  f.units[0].landArea=999;
  const correction:any=await f.service.createCorrection(result.id,result.sheets[0].id,"Land Area","builtUpArea","admin-1");
  const correctionPreview:any=await f.service.previewCorrection(result.id,correction.id);
  assert.equal(correctionPreview.affected,2);
  assert.equal(correctionPreview.conflicts,1);
  const applied:any=await f.service.confirmCorrection(result.id,correction.id,{});
  assert.equal(applied.applied,1);
  assert.equal(applied.conflictsKept,1);
  assert.equal(f.units[0].landArea,999);
  assert.equal(f.units[0].builtUpArea,undefined);
  assert.equal(f.units[1].landArea,null);
  assert.equal(f.units[1].builtUpArea,350);
});
