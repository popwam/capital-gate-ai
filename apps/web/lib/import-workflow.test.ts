import assert from "node:assert/strict";
import test from "node:test";
import { generatePreviewAndRefresh, IMPORT_STEPS, importNextAction, importStepState, type ImportWorkflow } from "./import-workflow.ts";

const workflow = (overrides: Partial<ImportWorkflow> = {}): ImportWorkflow => ({
  stage: "RESOLVE",
  selectedSheetCount: 1,
  ignoredSheetCount: 0,
  selectedSheets: ["Inventory"],
  ignoredSheets: [],
  activeTableCount: 1,
  activeIssueCount: 3,
  unresolvedBlockingCount: 3,
  unresolvedWarningCount: 0,
  missingCriticalMappings: [],
  missingContext: [],
  canPreview: false,
  canConfirm: false,
  previewExists: false,
  previewValid: false,
  previewRequired: false,
  legacyStateDetected: false,
  blockingReasons: ["Resolve import requirements"],
  status: "NEEDS_INPUT",
  nextRequiredAction: "RESOLVE_ISSUES",
  ...overrides,
});

test("Resolve shows only the canonical unresolved blocking count", () => {
  assert.equal(importStepState(workflow(), 2).count, 3);
  assert.equal(importStepState(workflow({ unresolvedBlockingCount: 0 }), 2).count, 0);
});

test("generated preview stays on Preview while Confirm Import is available", () => {
  assert.deepEqual(IMPORT_STEPS, ["Upload", "Analyze", "Resolve", "Preview", "Import"]);
  assert.equal(importStepState(workflow({ stage: "PREVIEW", unresolvedBlockingCount: 0, canPreview: true }), 2).complete, true);
  const confirmable = workflow({ stage: "IMPORT", unresolvedBlockingCount: 0, canPreview: true, canConfirm: true, previewExists: true, previewValid: true });
  assert.equal(importStepState(confirmable, 3).active, true);
  assert.equal(importStepState(confirmable, 4).active, false);
});

test("a completed import marks every wizard step complete", () => {
  for (let index = 0; index < IMPORT_STEPS.length; index++)
    assert.equal(importStepState(workflow({ stage: "COMPLETE", unresolvedBlockingCount: 0 }), index).complete, true);
});

test("READY without a preview always exposes Generate Preview", () => {
  assert.equal(importNextAction(workflow({ status: "READY", canPreview: true, previewExists: false, previewValid: false, previewRequired: true, unresolvedBlockingCount: 0, blockingReasons: [] })), "GENERATE_PREVIEW");
});

test("valid and stale previews produce deterministic actions", () => {
  assert.equal(importNextAction(workflow({ status: "READY", stage: "PREVIEW", canPreview: true, previewExists: true, previewValid: true, previewRequired: false, unresolvedBlockingCount: 0, blockingReasons: [] })), "VIEW_PREVIEW");
  assert.equal(importNextAction(workflow({ status: "READY", stage: "PREVIEW", canPreview: true, previewExists: true, previewValid: false, previewRequired: true, unresolvedBlockingCount: 0, blockingReasons: [] })), "REGENERATE_PREVIEW");
  assert.equal(importNextAction(workflow({ status: "READY", stage: "IMPORT", canPreview: true, canConfirm: true, previewExists: true, previewValid: true, previewRequired: false, unresolvedBlockingCount: 0, blockingReasons: [] })), "CONFIRM_IMPORT");
});

test("NEEDS_INPUT cannot generate preview", () => {
  assert.equal(importNextAction(workflow()), "RESOLVE");
});

test("preview generation posts then refetches canonical import state", async () => {
  const calls: string[] = [];
  const refreshed = { id: "import-1", workflow: workflow({ stage: "IMPORT", status: "READY", canPreview: true, canConfirm: true, previewExists: true, previewValid: true }) };
  const result = await generatePreviewAndRefresh<typeof refreshed>("import-1", {
    post: async <T>(path: string) => { calls.push(`POST ${path}`); return {} as T; },
    get: async <T>(path: string) => { calls.push(`GET ${path}`); return refreshed as T; },
  });
  assert.deepEqual(calls, ["POST /imports/import-1/preview", "GET /imports/import-1"]);
  assert.equal(result.workflow.stage, "IMPORT");
  assert.equal(importNextAction(result.workflow), "CONFIRM_IMPORT");
});

test("READY never produces zero next actions", () => {
  for (const state of [
    workflow({ status: "READY", canPreview: true, previewExists: false, previewValid: false }),
    workflow({ status: "READY", canPreview: true, previewExists: true, previewValid: false }),
    workflow({ status: "READY", canPreview: true, previewExists: true, previewValid: true }),
    workflow({ status: "READY", canPreview: true, canConfirm: true, previewExists: true, previewValid: true }),
  ]) assert.notEqual(importNextAction(state), "NONE");
});
