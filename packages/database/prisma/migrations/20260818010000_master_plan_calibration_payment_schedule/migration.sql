ALTER TABLE "Project" ADD COLUMN "masterPlanCalibration" JSONB;

ALTER TABLE "ProjectBuilding"
  ADD COLUMN "masterPlanX" DECIMAL(7,6),
  ADD COLUMN "masterPlanY" DECIMAL(7,6),
  ADD COLUMN "masterPlanLocationSource" TEXT,
  ADD COLUMN "masterPlanConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "masterPlanConfirmedByAdminId" TEXT;

ALTER TABLE "ProjectBuilding"
  ADD CONSTRAINT "ProjectBuilding_masterPlanConfirmedByAdminId_fkey"
  FOREIGN KEY ("masterPlanConfirmedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentPlan"
  ADD COLUMN "planType" TEXT NOT NULL DEFAULT 'INSTALLMENT',
  ADD COLUMN "reservationAmount" DECIMAL(16,2),
  ADD COLUMN "durationValue" INTEGER,
  ADD COLUMN "durationUnit" TEXT,
  ADD COLUMN "installmentEveryValue" INTEGER,
  ADD COLUMN "installmentEveryUnit" TEXT,
  ADD COLUMN "firstInstallmentTiming" TEXT,
  ADD COLUMN "percentageSchedule" JSONB;
