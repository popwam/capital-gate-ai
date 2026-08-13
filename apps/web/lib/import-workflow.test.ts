import assert from "node:assert/strict";
import test from "node:test";
import { IMPORT_STEPS, importStepState, type ImportWorkflow } from "./import-workflow.ts";

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

test("preview and import stages complete prior steps without reversing logical order", () => {
  assert.deepEqual(IMPORT_STEPS, ["Upload", "Analyze", "Resolve", "Preview", "Import"]);
  assert.equal(importStepState(workflow({ stage: "PREVIEW", unresolvedBlockingCount: 0, canPreview: true }), 2).complete, true);
  assert.equal(importStepState(workflow({ stage: "IMPORT", unresolvedBlockingCount: 0, canPreview: true, canConfirm: true, previewExists: true }), 4).active, true);
});

test("a completed import marks every wizard step complete", () => {
  for (let index = 0; index < IMPORT_STEPS.length; index++)
    assert.equal(importStepState(workflow({ stage: "COMPLETE", unresolvedBlockingCount: 0 }), index).complete, true);
});
