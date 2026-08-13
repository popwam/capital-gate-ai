-- Additive multi-sheet review state. Existing imports and inventory remain untouched.
CREATE TABLE "ImportSheet" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "sheetName" TEXT NOT NULL,
  "tableId" TEXT,
  "classification" TEXT NOT NULL,
  "confidence" INTEGER NOT NULL DEFAULT 0,
  "action" TEXT NOT NULL DEFAULT 'IGNORE',
  "headerRow" INTEGER,
  "startRow" INTEGER,
  "endRow" INTEGER,
  "rowsDetected" INTEGER NOT NULL DEFAULT 0,
  "rowsCreated" INTEGER NOT NULL DEFAULT 0,
  "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
  "projectId" TEXT,
  "developerId" TEXT,
  "locationId" TEXT,
  "defaultCurrency" TEXT,
  "defaultUnitType" TEXT,
  "columns" JSONB,
  "mappings" JSONB,
  "mappingSources" JSONB,
  "sourcePreview" JSONB,
  "normalizedPreview" JSONB,
  "mappingVersion" INTEGER NOT NULL DEFAULT 1,
  "previewMappingVersion" INTEGER,
  "importedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportSheet_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportSheet_importId_sheetName_tableId_key" ON "ImportSheet"("importId", "sheetName", "tableId");
CREATE INDEX "ImportSheet_importId_action_idx" ON "ImportSheet"("importId", "action");
CREATE INDEX "ImportSheet_projectId_idx" ON "ImportSheet"("projectId");
ALTER TABLE "ImportSheet" ADD CONSTRAINT "ImportSheet_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportSheet" ADD CONSTRAINT "ImportSheet_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportSheet" ADD CONSTRAINT "ImportSheet_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "Developer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportSheet" ADD CONSTRAINT "ImportSheet_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ImportUnitChange" ADD COLUMN "importSheetId" TEXT;
CREATE INDEX "ImportUnitChange_importSheetId_idx" ON "ImportUnitChange"("importSheetId");
ALTER TABLE "ImportUnitChange" ADD CONSTRAINT "ImportUnitChange_importSheetId_fkey" FOREIGN KEY ("importSheetId") REFERENCES "ImportSheet"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ImportCorrection" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "importSheetId" TEXT NOT NULL,
  "createdByAdminId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "oldMappings" JSONB NOT NULL,
  "proposedMappings" JSONB NOT NULL,
  "preview" JSONB,
  "conflictDecisions" JSONB,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ImportCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportCorrection_importId_status_idx" ON "ImportCorrection"("importId", "status");
CREATE INDEX "ImportCorrection_importSheetId_idx" ON "ImportCorrection"("importSheetId");
ALTER TABLE "ImportCorrection" ADD CONSTRAINT "ImportCorrection_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportCorrection" ADD CONSTRAINT "ImportCorrection_importSheetId_fkey" FOREIGN KEY ("importSheetId") REFERENCES "ImportSheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportCorrection" ADD CONSTRAINT "ImportCorrection_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ImportCorrectionChange" (
  "id" TEXT NOT NULL,
  "correctionId" TEXT NOT NULL,
  "unitId" TEXT,
  "beforeData" JSONB NOT NULL,
  "correctedData" JSONB NOT NULL,
  "currentData" JSONB NOT NULL,
  "conflict" BOOLEAN NOT NULL DEFAULT false,
  "decision" TEXT,
  "appliedAt" TIMESTAMP(3),
  CONSTRAINT "ImportCorrectionChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportCorrectionChange_correctionId_conflict_idx" ON "ImportCorrectionChange"("correctionId", "conflict");
CREATE INDEX "ImportCorrectionChange_unitId_idx" ON "ImportCorrectionChange"("unitId");
ALTER TABLE "ImportCorrectionChange" ADD CONSTRAINT "ImportCorrectionChange_correctionId_fkey" FOREIGN KEY ("correctionId") REFERENCES "ImportCorrection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportCorrectionChange" ADD CONSTRAINT "ImportCorrectionChange_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Project plans reuse PaymentPlan without copying rows to every unit.
ALTER TABLE "PaymentPlan" ALTER COLUMN "unitId" DROP NOT NULL;
ALTER TABLE "PaymentPlan" ADD COLUMN "projectId" TEXT;
CREATE INDEX "PaymentPlan_projectId_isActive_idx" ON "PaymentPlan"("projectId", "isActive");
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentPlan" ADD CONSTRAINT "PaymentPlan_exactly_one_owner_check" CHECK (("unitId" IS NOT NULL) <> ("projectId" IS NOT NULL));
