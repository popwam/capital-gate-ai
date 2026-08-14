-- Project internal spatial model: many gates, zones, buildings and unit proximities.
-- Safe additive migration; existing project/unit data remains valid.

ALTER TABLE "Unit"
  ADD COLUMN "internalLocationDescription" TEXT,
  ADD COLUMN "projectZoneId" TEXT,
  ADD COLUMN "projectBuildingId" TEXT;

CREATE TABLE "ProjectGate" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "nameEn" TEXT,
  "gateNumber" INTEGER,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "googlePlaceId" TEXT,
  "isMain" BOOLEAN NOT NULL DEFAULT false,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectGate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectZone" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "nameEn" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectBuilding" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "zoneId" TEXT,
  "code" TEXT,
  "name" TEXT NOT NULL,
  "nameAr" TEXT,
  "nameEn" TEXT,
  "latitude" DECIMAL(10,7),
  "longitude" DECIMAL(10,7),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectBuilding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UnitProximity" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "gateId" TEXT,
  "amenityId" TEXT,
  "landmarkId" TEXT,
  "distanceMeters" INTEGER,
  "walkingMinutes" INTEGER,
  "drivingMinutes" INTEGER,
  "source" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UnitProximity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProjectGate_projectId_name_key" ON "ProjectGate"("projectId", "name");
CREATE INDEX "ProjectGate_projectId_isActive_idx" ON "ProjectGate"("projectId", "isActive");
CREATE UNIQUE INDEX "ProjectZone_projectId_name_key" ON "ProjectZone"("projectId", "name");
CREATE INDEX "ProjectZone_projectId_idx" ON "ProjectZone"("projectId");
CREATE UNIQUE INDEX "ProjectBuilding_projectId_name_key" ON "ProjectBuilding"("projectId", "name");
CREATE INDEX "ProjectBuilding_projectId_zoneId_idx" ON "ProjectBuilding"("projectId", "zoneId");
CREATE INDEX "Unit_projectZoneId_idx" ON "Unit"("projectZoneId");
CREATE INDEX "Unit_projectBuildingId_idx" ON "Unit"("projectBuildingId");
CREATE INDEX "UnitProximity_unitId_targetType_idx" ON "UnitProximity"("unitId", "targetType");
CREATE INDEX "UnitProximity_gateId_idx" ON "UnitProximity"("gateId");
CREATE INDEX "UnitProximity_amenityId_idx" ON "UnitProximity"("amenityId");
CREATE INDEX "UnitProximity_landmarkId_idx" ON "UnitProximity"("landmarkId");

ALTER TABLE "ProjectGate" ADD CONSTRAINT "ProjectGate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectZone" ADD CONSTRAINT "ProjectZone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectBuilding" ADD CONSTRAINT "ProjectBuilding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectBuilding" ADD CONSTRAINT "ProjectBuilding_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ProjectZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_projectZoneId_fkey" FOREIGN KEY ("projectZoneId") REFERENCES "ProjectZone"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_projectBuildingId_fkey" FOREIGN KEY ("projectBuildingId") REFERENCES "ProjectBuilding"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UnitProximity" ADD CONSTRAINT "UnitProximity_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitProximity" ADD CONSTRAINT "UnitProximity_gateId_fkey" FOREIGN KEY ("gateId") REFERENCES "ProjectGate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitProximity" ADD CONSTRAINT "UnitProximity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UnitProximity" ADD CONSTRAINT "UnitProximity_landmarkId_fkey" FOREIGN KEY ("landmarkId") REFERENCES "ProjectLandmark"("id") ON DELETE CASCADE ON UPDATE CASCADE;
