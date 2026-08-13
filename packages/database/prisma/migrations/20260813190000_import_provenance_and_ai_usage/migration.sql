ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "ImportStatus" ADD VALUE IF NOT EXISTS 'ROLLED_BACK';

CREATE TYPE "ImportUnitOperation" AS ENUM ('CREATED', 'UPDATED');

ALTER TABLE "DataImport"
  ADD COLUMN "name" TEXT,
  ADD COLUMN "uploadedByAdminId" TEXT,
  ADD COLUMN "parentImportId" TEXT,
  ADD COLUMN "missingUnitPolicy" TEXT NOT NULL DEFAULT 'LEAVE_UNCHANGED',
  ADD COLUMN "completedAt" TIMESTAMP(3),
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "rolledBackAt" TIMESTAMP(3);

ALTER TABLE "Unit" ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "ProjectKnowledgeItem"
  ADD COLUMN "approvedByAdminId" TEXT,
  ADD COLUMN "approvedAt" TIMESTAMP(3);

CREATE TABLE "ImportUnitChange" (
  "id" TEXT NOT NULL,
  "importId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "operation" "ImportUnitOperation" NOT NULL,
  "beforeData" JSONB,
  "afterData" JSONB NOT NULL,
  "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revertedAt" TIMESTAMP(3),
  "conflictReason" TEXT,
  CONSTRAINT "ImportUnitChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ImportUnitChange_importId_unitId_key" ON "ImportUnitChange"("importId", "unitId");
CREATE INDEX "ImportUnitChange_unitId_appliedAt_idx" ON "ImportUnitChange"("unitId", "appliedAt");

CREATE TABLE "AIUsage" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "taskType" TEXT NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "latencyMs" INTEGER NOT NULL,
  "success" BOOLEAN NOT NULL,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AIUsage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AIUsage_provider_createdAt_idx" ON "AIUsage"("provider", "createdAt");
CREATE INDEX "AIUsage_taskType_createdAt_idx" ON "AIUsage"("taskType", "createdAt");

ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_uploadedByAdminId_fkey" FOREIGN KEY ("uploadedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DataImport" ADD CONSTRAINT "DataImport_parentImportId_fkey" FOREIGN KEY ("parentImportId") REFERENCES "DataImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectKnowledgeItem" ADD CONSTRAINT "ProjectKnowledgeItem_approvedByAdminId_fkey" FOREIGN KEY ("approvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ImportUnitChange" ADD CONSTRAINT "ImportUnitChange_importId_fkey" FOREIGN KEY ("importId") REFERENCES "DataImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportUnitChange" ADD CONSTRAINT "ImportUnitChange_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
