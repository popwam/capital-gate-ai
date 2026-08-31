ALTER TABLE "PropertyRequirement"
  ADD COLUMN "budgetOriginalAmount" DECIMAL(16,2),
  ADD COLUMN "budgetOriginalCurrency" TEXT,
  ADD COLUMN "budgetNormalizedAmount" DECIMAL(16,2),
  ADD COLUMN "budgetNormalizedCurrency" TEXT,
  ADD COLUMN "fxRate" DECIMAL(18,8),
  ADD COLUMN "fxAsOf" TIMESTAMP(3),
  ADD COLUMN "fxSource" TEXT;
