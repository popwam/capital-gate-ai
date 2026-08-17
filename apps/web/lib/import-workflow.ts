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

/**
 * The admin should think in four decisions, not backend state names:
 * source -> project scope -> field meaning -> preview/commit.
 */
export const IMPORT_STEPS = [
  "المصدر",
  "السياق",
  "الحقول",
  "المعاينة والاعتماد",
] as const;

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
  let activeIndex = 0;
  if (workflow.stage === "COMPLETE") activeIndex = IMPORT_STEPS.length;
  else if (workflow.stage === "FAILED") activeIndex = 0;
  else if (workflow.selectedSheetCount === 0 || workflow.activeTableCount === 0) activeIndex = 0;
  else if (workflow.missingContext.length > 0) activeIndex = 1;
  else if (workflow.unresolvedBlockingCount > 0 || workflow.missingCriticalMappings.length > 0) activeIndex = 2;
  else activeIndex = 3;

  const contextCount = workflow.missingContext.length;
  const fieldCount = Math.max(0, workflow.unresolvedBlockingCount - contextCount) + workflow.missingCriticalMappings.length;
  return {
    complete: index < activeIndex,
    active: index === activeIndex,
    count: index === 1 ? contextCount : index === 2 ? fieldCount : 0,
  };
}
