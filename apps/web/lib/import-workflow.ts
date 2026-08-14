export type ImportWorkflow = {
  stage: "UPLOAD" | "ANALYZE" | "RESOLVE" | "PREVIEW" | "IMPORT" | "COMPLETE" | "FAILED";
  selectedSheetCount: number;
  ignoredSheetCount: number;
  selectedSheets: string[];
  ignoredSheets: string[];
  activeTableCount: number;
  activeIssueCount: number;
  unresolvedBlockingCount: number;
  unresolvedWarningCount: number;
  missingCriticalMappings: string[];
  missingContext: string[];
  canPreview: boolean;
  canConfirm: boolean;
  previewExists: boolean;
  previewValid: boolean;
  previewRequired: boolean;
  legacyStateDetected: boolean;
  blockingReasons: string[];
  status: string;
  nextRequiredAction: "RESOLVE_ISSUES" | "GENERATE_PREVIEW" | "CONFIRM_IMPORT" | "NONE";
};

export const IMPORT_STEPS = ["Upload", "Analyze", "Resolve", "Preview", "Import"] as const;

export type ImportNextAction = "RESOLVE" | "GENERATE_PREVIEW" | "REGENERATE_PREVIEW" | "VIEW_PREVIEW" | "CONFIRM_IMPORT" | "NONE";

export function importNextAction(workflow: ImportWorkflow): ImportNextAction {
  if (workflow.stage === "COMPLETE" || workflow.stage === "FAILED") return "NONE";
  if (!workflow.canPreview) return "RESOLVE";
  if (workflow.previewExists && !workflow.previewValid) return "REGENERATE_PREVIEW";
  if (!workflow.previewExists) return "GENERATE_PREVIEW";
  if (workflow.canConfirm) return "CONFIRM_IMPORT";
  return "VIEW_PREVIEW";
}

export async function generatePreviewAndRefresh<T>(
  importId: string,
  api: { post: <R>(path: string, body?: unknown) => Promise<R>; get: <R>(path: string) => Promise<R> },
) {
  await api.post(`/imports/${importId}/preview`);
  return api.get<T>(`/imports/${importId}`);
}

export function importStepState(workflow: ImportWorkflow, index: number) {
  const activeIndex = workflow.stage === "COMPLETE"
    ? IMPORT_STEPS.length
    : workflow.stage === "IMPORT"
      ? 3
      : workflow.stage === "PREVIEW"
        ? 3
        : workflow.stage === "RESOLVE"
          ? 2
          : workflow.stage === "ANALYZE"
            ? 1
            : 0;
  return {
    complete: index < activeIndex,
    active: index === activeIndex,
    count: index === 2 ? workflow.unresolvedBlockingCount : 0,
  };
}
