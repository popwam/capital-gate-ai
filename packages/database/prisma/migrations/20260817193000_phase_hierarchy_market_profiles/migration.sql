-- Cg Ai phase hierarchy and scoped market intelligence.
-- Additive migration: existing project/unit data is preserved.
ALTER TABLE "Project"
  ADD COLUMN "projectTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "deliveryStatuses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Project"
SET "projectTypes" = ARRAY["projectType"]
WHERE "projectType" IS NOT NULL AND BTRIM("projectType") <> '';

UPDATE "Project"
SET "deliveryStatuses" = ARRAY["deliveryStatus"]
WHERE "deliveryStatus" IS NOT NULL AND BTRIM("deliveryStatus") <> '';

CREATE TABLE "ProjectPhase" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "nameEn" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "launchYear" INTEGER,
  "deliveryYear" INTEGER,
  "status" TEXT,
  "deliveryStatuses" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "projectTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "constructionPercentage" DECIMAL(7,4),
  "unitTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "finishingOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customerFit" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "minArea" DECIMAL(10,2),
  "maxArea" DECIMAL(10,2),
  "minBedrooms" INTEGER,
  "maxBedrooms" INTEGER,
  "descriptionAr" TEXT,
  "descriptionEn" TEXT,
  "deliveryNotesAr" TEXT,
  "deliveryNotesEn" TEXT,
  "masterPlanPolygon" JSONB,
  "sourceMetadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectPhase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectPhase_projectId_name_key" ON "ProjectPhase"("projectId", "name");
CREATE INDEX "ProjectPhase_projectId_sortOrder_idx" ON "ProjectPhase"("projectId", "sortOrder");
CREATE INDEX "ProjectPhase_deliveryYear_status_idx" ON "ProjectPhase"("deliveryYear", "status");
ALTER TABLE "ProjectPhase" ADD CONSTRAINT "ProjectPhase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "ImportSheet" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "ImportSheet" ADD CONSTRAINT "ImportSheet_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ImportSheet_phaseId_idx" ON "ImportSheet"("phaseId");

ALTER TABLE "Unit" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Unit_phaseId_idx" ON "Unit"("phaseId");

ALTER TABLE "ProjectGate" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "ProjectGate" ADD CONSTRAINT "ProjectGate_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ProjectGate_phaseId_idx" ON "ProjectGate"("phaseId");

ALTER TABLE "ProjectZone"
  ADD COLUMN "phaseId" TEXT,
  ADD COLUMN "masterPlanPolygon" JSONB;
ALTER TABLE "ProjectZone" ADD CONSTRAINT "ProjectZone_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ProjectZone_phaseId_idx" ON "ProjectZone"("phaseId");

ALTER TABLE "ProjectBuilding"
  ADD COLUMN "phaseId" TEXT,
  ADD COLUMN "masterPlanPolygon" JSONB;
ALTER TABLE "ProjectBuilding" ADD CONSTRAINT "ProjectBuilding_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ProjectBuilding_phaseId_idx" ON "ProjectBuilding"("phaseId");

ALTER TABLE "PaymentPlan"
  ADD COLUMN "phaseId" TEXT,
  ADD COLUMN "firstInstallmentAfterValue" INTEGER,
  ADD COLUMN "firstInstallmentAfterUnit" TEXT,
  ADD COLUMN "distributionMode" TEXT NOT NULL DEFAULT 'EQUAL';
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PaymentPlan_phaseId_isActive_idx" ON "PaymentPlan"("phaseId", "isActive");

ALTER TABLE "Media" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "Media" ADD CONSTRAINT "Media_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Document" ADD COLUMN "phaseId" TEXT;
ALTER TABLE "Document" ADD CONSTRAINT "Document_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "MarketProfile" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "phaseId" TEXT,
  "unitId" TEXT,
  "segment" TEXT NOT NULL,
  "propertyUse" TEXT NOT NULL DEFAULT 'RESIDENTIAL',
  "suitability" TEXT,
  "demand" TEXT,
  "yieldMin" DECIMAL(7,4),
  "yieldMax" DECIMAL(7,4),
  "liquidity" TEXT,
  "targetCustomers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "advantages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "risks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "metrics" JSONB,
  "notes" TEXT,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MarketProfile_projectId_segment_propertyUse_idx" ON "MarketProfile"("projectId", "segment", "propertyUse");
CREATE INDEX "MarketProfile_phaseId_segment_idx" ON "MarketProfile"("phaseId", "segment");
CREATE INDEX "MarketProfile_unitId_segment_idx" ON "MarketProfile"("unitId", "segment");
ALTER TABLE "MarketProfile" ADD CONSTRAINT "MarketProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketProfile" ADD CONSTRAINT "MarketProfile_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "ProjectPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketProfile" ADD CONSTRAINT "MarketProfile_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
