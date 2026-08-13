import { ImportUnitOperation } from "@prisma/client";

export function rollbackConflict(input: { operation: ImportUnitOperation; unitExists: boolean; currentMatchesAppliedSnapshot: boolean; laterImportExists: boolean; hasAttachedMedia: boolean }) {
  if (input.laterImportExists) return "A later import changed this unit";
  if (!input.unitExists) return "Unit no longer exists";
  if (input.operation === ImportUnitOperation.CREATED && input.hasAttachedMedia) return "Unit has attached media";
  if (!input.currentMatchesAppliedSnapshot) return "Unit was edited after this import";
  return null;
}
