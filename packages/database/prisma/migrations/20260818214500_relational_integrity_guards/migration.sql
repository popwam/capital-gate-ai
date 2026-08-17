-- Relational integrity guards for Cg Ai real-estate hierarchy.
-- Prisma foreign keys prove that related rows exist. These triggers additionally prove
-- that cross-linked rows belong to the SAME developer/project/phase/zone context.

CREATE OR REPLACE FUNCTION "cg_validate_unit_hierarchy"()
RETURNS trigger AS $$
DECLARE
  project_developer text;
  related_project text;
  related_phase text;
BEGIN
  SELECT "developerId" INTO project_developer FROM "Project" WHERE id = NEW."projectId";
  IF project_developer IS NULL OR project_developer IS DISTINCT FROM NEW."developerId" THEN
    RAISE EXCEPTION 'Unit developer must own the selected project';
  END IF;

  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO related_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Unit phase must belong to the selected project';
    END IF;
  END IF;

  IF NEW."projectZoneId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO related_project, related_phase FROM "ProjectZone" WHERE id = NEW."projectZoneId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Unit zone must belong to the selected project';
    END IF;
    IF related_phase IS NOT NULL AND related_phase IS DISTINCT FROM NEW."phaseId" THEN
      RAISE EXCEPTION 'Unit zone must belong to the selected phase';
    END IF;
  END IF;

  IF NEW."projectBuildingId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO related_project, related_phase FROM "ProjectBuilding" WHERE id = NEW."projectBuildingId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Unit building must belong to the selected project';
    END IF;
    IF related_phase IS NOT NULL AND related_phase IS DISTINCT FROM NEW."phaseId" THEN
      RAISE EXCEPTION 'Unit building must belong to the selected phase';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "trg_cg_validate_unit_hierarchy" ON "Unit";
CREATE TRIGGER "trg_cg_validate_unit_hierarchy"
BEFORE INSERT OR UPDATE OF "developerId", "projectId", "phaseId", "projectBuildingId", "projectZoneId"
ON "Unit" FOR EACH ROW EXECUTE FUNCTION "cg_validate_unit_hierarchy"();

CREATE OR REPLACE FUNCTION "cg_validate_gate_hierarchy"()
RETURNS trigger AS $$
DECLARE phase_project text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO phase_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF phase_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Project gate phase must belong to the selected project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_gate_hierarchy" ON "ProjectGate";
CREATE TRIGGER "trg_cg_validate_gate_hierarchy"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId"
ON "ProjectGate" FOR EACH ROW EXECUTE FUNCTION "cg_validate_gate_hierarchy"();

CREATE OR REPLACE FUNCTION "cg_validate_zone_hierarchy"()
RETURNS trigger AS $$
DECLARE phase_project text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO phase_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF phase_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Project zone phase must belong to the selected project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_zone_hierarchy" ON "ProjectZone";
CREATE TRIGGER "trg_cg_validate_zone_hierarchy"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId"
ON "ProjectZone" FOR EACH ROW EXECUTE FUNCTION "cg_validate_zone_hierarchy"();

CREATE OR REPLACE FUNCTION "cg_validate_building_hierarchy"()
RETURNS trigger AS $$
DECLARE
  phase_project text;
  zone_project text;
  zone_phase text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO phase_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF phase_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Project building phase must belong to the selected project';
    END IF;
  END IF;

  IF NEW."zoneId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO zone_project, zone_phase FROM "ProjectZone" WHERE id = NEW."zoneId";
    IF zone_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Project building zone must belong to the selected project';
    END IF;
    IF zone_phase IS NOT NULL AND zone_phase IS DISTINCT FROM NEW."phaseId" THEN
      RAISE EXCEPTION 'Project building zone must belong to the selected phase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_building_hierarchy" ON "ProjectBuilding";
CREATE TRIGGER "trg_cg_validate_building_hierarchy"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId", "zoneId"
ON "ProjectBuilding" FOR EACH ROW EXECUTE FUNCTION "cg_validate_building_hierarchy"();

CREATE OR REPLACE FUNCTION "cg_validate_import_sheet_context"()
RETURNS trigger AS $$
DECLARE
  project_developer text;
  project_location text;
  phase_project text;
BEGIN
  IF NEW."projectId" IS NULL THEN
    IF NEW."phaseId" IS NOT NULL THEN RAISE EXCEPTION 'Import sheet phase requires a project'; END IF;
    RETURN NEW;
  END IF;

  SELECT "developerId", "locationId" INTO project_developer, project_location FROM "Project" WHERE id = NEW."projectId";
  IF NEW."developerId" IS NOT NULL AND project_developer IS DISTINCT FROM NEW."developerId" THEN
    RAISE EXCEPTION 'Import sheet developer must match the selected project';
  END IF;
  IF NEW."locationId" IS NOT NULL AND project_location IS NOT NULL AND project_location IS DISTINCT FROM NEW."locationId" THEN
    RAISE EXCEPTION 'Import sheet location must match the selected project';
  END IF;
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO phase_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF phase_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Import sheet phase must belong to the selected project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_import_sheet_context" ON "ImportSheet";
CREATE TRIGGER "trg_cg_validate_import_sheet_context"
BEFORE INSERT OR UPDATE OF "projectId", "developerId", "locationId", "phaseId"
ON "ImportSheet" FOR EACH ROW EXECUTE FUNCTION "cg_validate_import_sheet_context"();

CREATE OR REPLACE FUNCTION "cg_validate_market_profile_scope"()
RETURNS trigger AS $$
DECLARE
  related_project text;
  related_phase text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO related_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Market profile phase must belong to the selected project';
    END IF;
  END IF;
  IF NEW."unitId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO related_project, related_phase FROM "Unit" WHERE id = NEW."unitId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Market profile unit must belong to the selected project';
    END IF;
    IF NEW."phaseId" IS NOT NULL AND related_phase IS DISTINCT FROM NEW."phaseId" THEN
      RAISE EXCEPTION 'Market profile unit must belong to the selected phase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_market_scope" ON "MarketProfile";
CREATE TRIGGER "trg_cg_validate_market_scope"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId", "unitId"
ON "MarketProfile" FOR EACH ROW EXECUTE FUNCTION "cg_validate_market_profile_scope"();

CREATE OR REPLACE FUNCTION "cg_validate_payment_plan_scope"()
RETURNS trigger AS $$
DECLARE
  related_project text;
  related_phase text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    SELECT "projectId" INTO related_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF NEW."projectId" IS NULL OR related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Payment plan phase requires its owning project';
    END IF;
  END IF;
  IF NEW."unitId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO related_project, related_phase FROM "Unit" WHERE id = NEW."unitId";
    IF NEW."projectId" IS NOT NULL AND related_project IS DISTINCT FROM NEW."projectId" THEN
      RAISE EXCEPTION 'Payment plan unit does not belong to the selected project';
    END IF;
    IF NEW."phaseId" IS NOT NULL AND related_phase IS DISTINCT FROM NEW."phaseId" THEN
      RAISE EXCEPTION 'Payment plan unit does not belong to the selected phase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_payment_scope" ON "PaymentPlan";
CREATE TRIGGER "trg_cg_validate_payment_scope"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId", "unitId"
ON "PaymentPlan" FOR EACH ROW EXECUTE FUNCTION "cg_validate_payment_plan_scope"();

CREATE OR REPLACE FUNCTION "cg_validate_media_scope"()
RETURNS trigger AS $$
DECLARE
  related_project text;
  related_phase text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    IF NEW."projectId" IS NULL THEN RAISE EXCEPTION 'Phase media requires a project'; END IF;
    SELECT "projectId" INTO related_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Media phase must belong to project'; END IF;
  END IF;
  IF NEW."unitId" IS NOT NULL THEN
    SELECT "projectId", "phaseId" INTO related_project, related_phase FROM "Unit" WHERE id = NEW."unitId";
    IF NEW."projectId" IS NOT NULL AND related_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Media unit does not belong to project'; END IF;
    IF NEW."phaseId" IS NOT NULL AND related_phase IS DISTINCT FROM NEW."phaseId" THEN RAISE EXCEPTION 'Media unit does not belong to phase'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_media_scope" ON "Media";
CREATE TRIGGER "trg_cg_validate_media_scope"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId", "unitId"
ON "Media" FOR EACH ROW EXECUTE FUNCTION "cg_validate_media_scope"();

CREATE OR REPLACE FUNCTION "cg_validate_document_scope"()
RETURNS trigger AS $$
DECLARE related_project text;
BEGIN
  IF NEW."phaseId" IS NOT NULL THEN
    IF NEW."projectId" IS NULL THEN RAISE EXCEPTION 'Phase document requires a project'; END IF;
    SELECT "projectId" INTO related_project FROM "ProjectPhase" WHERE id = NEW."phaseId";
    IF related_project IS DISTINCT FROM NEW."projectId" THEN RAISE EXCEPTION 'Document phase must belong to project'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS "trg_cg_validate_document_scope" ON "Document";
CREATE TRIGGER "trg_cg_validate_document_scope"
BEFORE INSERT OR UPDATE OF "projectId", "phaseId"
ON "Document" FOR EACH ROW EXECUTE FUNCTION "cg_validate_document_scope"();
