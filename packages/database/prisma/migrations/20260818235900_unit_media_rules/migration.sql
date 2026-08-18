-- Unit/phase media matching rules. Existing gallery media remains unchanged.
ALTER TABLE "Media"
ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'GALLERY';

CREATE TABLE IF NOT EXISTS "UnitMediaRule" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "phaseId" TEXT,
    "mediaId" TEXT NOT NULL,
    "unitType" TEXT,
    "unitSubType" TEXT,
    "bedrooms" INTEGER,
    "bathrooms" INTEGER,
    "minBuiltUpArea" DECIMAL(10,2),
    "maxBuiltUpArea" DECIMAL(10,2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UnitMediaRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UnitMediaRule_projectId_phaseId_isActive_idx" ON "UnitMediaRule"("projectId", "phaseId", "isActive");
CREATE INDEX IF NOT EXISTS "UnitMediaRule_bedrooms_bathrooms_idx" ON "UnitMediaRule"("bedrooms", "bathrooms");
CREATE INDEX IF NOT EXISTS "UnitMediaRule_minBuiltUpArea_maxBuiltUpArea_idx" ON "UnitMediaRule"("minBuiltUpArea", "maxBuiltUpArea");
CREATE INDEX IF NOT EXISTS "UnitMediaRule_mediaId_idx" ON "UnitMediaRule"("mediaId");

DO $$ BEGIN
  ALTER TABLE "UnitMediaRule" ADD CONSTRAINT "UnitMediaRule_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "UnitMediaRule" ADD CONSTRAINT "UnitMediaRule_phaseId_fkey"
    FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "UnitMediaRule" ADD CONSTRAINT "UnitMediaRule_mediaId_fkey"
    FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Database-level guard: a rule's phase and media must belong to the same project as the rule.
CREATE OR REPLACE FUNCTION cg_validate_unit_media_rule() RETURNS trigger AS $$
DECLARE
  phase_project TEXT;
  media_project TEXT;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO phase_project FROM "ProjectPhase" WHERE "id" = NEW."phaseId";
    IF phase_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'UnitMediaRule phase does not belong to project';
    END IF;
  END IF;

  SELECT "projectId" INTO media_project FROM "Media" WHERE "id" = NEW."mediaId";
  IF media_project IS DISTINCT FROM NEW."projectId" THEN
    RAISE EXCEPTION 'UnitMediaRule media does not belong to project';
  END IF;

  IF NEW."minBuiltUpArea" IS NOT NULL AND NEW."maxBuiltUpArea" IS NOT NULL
     AND NEW."minBuiltUpArea" > NEW."maxBuiltUpArea" THEN
    RAISE EXCEPTION 'UnitMediaRule min area cannot exceed max area';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cg_unit_media_rule_integrity" ON "UnitMediaRule";
CREATE TRIGGER "cg_unit_media_rule_integrity"
BEFORE INSERT OR UPDATE ON "UnitMediaRule"
FOR EACH ROW EXECUTE FUNCTION cg_validate_unit_media_rule();
