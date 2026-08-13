ALTER TABLE "PaymentPlan"
  ADD COLUMN "durationMonths" INTEGER,
  ADD COLUMN "downPaymentAmount" DECIMAL(16,2),
  ADD COLUMN "downPaymentPercent" DECIMAL(7,4),
  ADD COLUMN "totalPrice" DECIMAL(16,2),
  ADD COLUMN "installmentFrequency" TEXT,
  ADD COLUMN "currency" TEXT,
  ADD COLUMN "maintenanceAmount" DECIMAL(16,2),
  ADD COLUMN "maintenancePercent" DECIMAL(7,4),
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "validTo" TIMESTAMP(3),
  ADD COLUMN "sourceImportId" TEXT,
  ADD COLUMN "sourceMetadata" JSONB;

ALTER TABLE "ImportIssue"
  ADD COLUMN "inputType" TEXT,
  ADD COLUMN "options" JSONB,
  ADD COLUMN "required" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PaymentPlan"
  ADD CONSTRAINT "PaymentPlan_sourceImportId_fkey"
  FOREIGN KEY ("sourceImportId") REFERENCES "DataImport"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PaymentPlan_unitId_durationMonths_idx"
  ON "PaymentPlan"("unitId", "durationMonths");
CREATE INDEX "PaymentPlan_sourceImportId_idx"
  ON "PaymentPlan"("sourceImportId");
