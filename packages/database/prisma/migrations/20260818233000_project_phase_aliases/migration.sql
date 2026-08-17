CREATE TABLE "ProjectPhaseAlias" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectPhaseAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectPhaseAlias_projectId_normalizedValue_key"
ON "ProjectPhaseAlias"("projectId", "normalizedValue");

CREATE INDEX "ProjectPhaseAlias_phaseId_idx"
ON "ProjectPhaseAlias"("phaseId");

ALTER TABLE "ProjectPhaseAlias"
ADD CONSTRAINT "ProjectPhaseAlias_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProjectPhaseAlias"
ADD CONSTRAINT "ProjectPhaseAlias_phaseId_fkey"
FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION enforce_project_phase_alias_project_match()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "ProjectPhase" p
    WHERE p."id" = NEW."phaseId" AND p."projectId" = NEW."projectId"
  ) THEN
    RAISE EXCEPTION 'ProjectPhaseAlias phase must belong to the same project';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ProjectPhaseAlias_project_match"
BEFORE INSERT OR UPDATE ON "ProjectPhaseAlias"
FOR EACH ROW EXECUTE FUNCTION enforce_project_phase_alias_project_match();
