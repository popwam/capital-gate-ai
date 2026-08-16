ALTER TABLE "Project"
  ADD COLUMN "boundaryGeoJson" JSONB,
  ADD COLUMN "boundarySource" TEXT,
  ADD COLUMN "boundaryConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "boundaryConfirmedByAdminId" TEXT;

ALTER TABLE "ProjectGate"
  ADD COLUMN "locationSource" TEXT,
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedByAdminId" TEXT;

ALTER TABLE "Project"
  ADD CONSTRAINT "Project_boundaryConfirmedByAdminId_fkey"
  FOREIGN KEY ("boundaryConfirmedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProjectGate"
  ADD CONSTRAINT "ProjectGate_confirmedByAdminId_fkey"
  FOREIGN KEY ("confirmedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
