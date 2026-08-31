ALTER TABLE "PropertyRequirement"
  ADD COLUMN "recentResultIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "selectedUnitId" TEXT,
  ADD COLUMN "selectedProjectId" TEXT,
  ADD COLUMN "comparisonUnitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
