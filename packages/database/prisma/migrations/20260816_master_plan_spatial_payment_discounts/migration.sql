ALTER TABLE "Unit"
  ADD COLUMN "masterPlanX" DECIMAL(7,6),
  ADD COLUMN "masterPlanY" DECIMAL(7,6),
  ADD COLUMN "masterPlanLocationStatus" TEXT NOT NULL DEFAULT 'UNLOCATED',
  ADD COLUMN "masterPlanLocationSource" TEXT,
  ADD COLUMN "masterPlanConfidence" DECIMAL(4,3),
  ADD COLUMN "masterPlanConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "masterPlanConfirmedByAdminId" TEXT;

ALTER TABLE "ProjectGate"
  ADD COLUMN "masterPlanX" DECIMAL(7,6),
  ADD COLUMN "masterPlanY" DECIMAL(7,6);

ALTER TABLE "PaymentPlan"
  ADD COLUMN "totalPriceOverride" DECIMAL(16,2),
  ADD COLUMN "discountAmount" DECIMAL(16,2),
  ADD COLUMN "discountPercent" DECIMAL(7,4);

ALTER TABLE "Unit"
  ADD CONSTRAINT "Unit_masterPlanConfirmedByAdminId_fkey"
  FOREIGN KEY ("masterPlanConfirmedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Unit_masterPlanLocationStatus_idx" ON "Unit"("projectId", "masterPlanLocationStatus");
