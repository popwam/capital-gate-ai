-- Additive canonical real-estate knowledge model. Existing rows and inventory are preserved.
ALTER TABLE "Location"
  ADD COLUMN "canonicalName" TEXT,
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "formattedAddress" TEXT,
  ADD COLUMN "source" TEXT;

ALTER TABLE "LocationDistance"
  ADD COLUMN "verifiedByAdminId" TEXT;

ALTER TABLE "Developer"
  ADD COLUMN "canonicalName" TEXT,
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "shortName" TEXT,
  ADD COLUMN "brandName" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "coverImageUrl" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "foundedYear" INTEGER,
  ADD COLUMN "headquarters" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "developerType" TEXT,
  ADD COLUMN "salesPhone" TEXT,
  ADD COLUMN "email" TEXT,
  ADD COLUMN "socialLinks" JSONB,
  ADD COLUMN "shortDescriptionAr" TEXT,
  ADD COLUMN "shortDescriptionEn" TEXT,
  ADD COLUMN "fullDescriptionAr" TEXT,
  ADD COLUMN "fullDescriptionEn" TEXT,
  ADD COLUMN "yearsInMarket" INTEGER,
  ADD COLUMN "deliveredProjectsCount" INTEGER,
  ADD COLUMN "projectsUnderConstructionCount" INTEGER,
  ADD COLUMN "geographicFocus" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "specialties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sourceMetadata" JSONB;

ALTER TABLE "Project"
  ADD COLUMN "canonicalName" TEXT,
  ADD COLUMN "nameAr" TEXT,
  ADD COLUMN "nameEn" TEXT,
  ADD COLUMN "shortDescriptionAr" TEXT,
  ADD COLUMN "shortDescriptionEn" TEXT,
  ADD COLUMN "fullDescriptionAr" TEXT,
  ADD COLUMN "fullDescriptionEn" TEXT,
  ADD COLUMN "adminStatus" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "launchDate" TIMESTAMP(3),
  ADD COLUMN "launchYear" INTEGER,
  ADD COLUMN "officialWebsite" TEXT,
  ADD COLUMN "formattedAddress" TEXT,
  ADD COLUMN "googlePlaceId" TEXT,
  ADD COLUMN "deliveryStatus" TEXT,
  ADD COLUMN "deliveryDate" TIMESTAMP(3),
  ADD COLUMN "deliveryYear" INTEGER,
  ADD COLUMN "finishingOptions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "totalLandArea" DECIMAL(14,2),
  ADD COLUMN "builtUpPercentage" DECIMAL(7,4),
  ADD COLUMN "numberOfPhases" INTEGER,
  ADD COLUMN "totalUnits" INTEGER,
  ADD COLUMN "densityDescription" TEXT,
  ADD COLUMN "gatedCommunity" BOOLEAN,
  ADD COLUMN "unitTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "minArea" DECIMAL(10,2),
  ADD COLUMN "maxArea" DECIMAL(10,2),
  ADD COLUMN "minBedrooms" INTEGER,
  ADD COLUMN "maxBedrooms" INTEGER,
  ADD COLUMN "priceSummary" TEXT,
  ADD COLUMN "paymentSummary" TEXT,
  ADD COLUMN "maintenanceSummary" TEXT,
  ADD COLUMN "clubFeesSummary" TEXT,
  ADD COLUMN "customerFit" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sourceMetadata" JSONB;

ALTER TABLE "Media"
  ADD COLUMN "altTextAr" TEXT,
  ADD COLUMN "altTextEn" TEXT,
  ADD COLUMN "caption" TEXT,
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "isCover" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Document"
  ADD COLUMN "storageKey" TEXT,
  ADD COLUMN "language" TEXT,
  ADD COLUMN "source" TEXT,
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "validTo" TIMESTAMP(3);

CREATE TABLE "DeveloperProjectPortfolio" (
  "id" TEXT NOT NULL,
  "developerId" TEXT NOT NULL,
  "projectName" TEXT NOT NULL,
  "locationText" TEXT,
  "locationId" TEXT,
  "projectType" TEXT,
  "status" TEXT NOT NULL,
  "launchYear" INTEGER,
  "deliveryYear" INTEGER,
  "unitsCount" INTEGER,
  "description" TEXT,
  "source" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeveloperProjectPortfolio_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Amenity" (
  "id" TEXT NOT NULL,
  "canonicalName" TEXT NOT NULL,
  "nameAr" TEXT,
  "nameEn" TEXT,
  "category" TEXT,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectAmenity" (
  "projectId" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "notes" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT,
  CONSTRAINT "ProjectAmenity_pkey" PRIMARY KEY ("projectId", "amenityId")
);

CREATE TABLE "ProjectInvestmentProfile" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "suitableForLiving" BOOLEAN,
  "suitableForInvestment" BOOLEAN,
  "suitableForRental" BOOLEAN,
  "resaleDemand" TEXT,
  "rentalDemand" TEXT,
  "expectedRentalYieldMin" DECIMAL(7,4),
  "expectedRentalYieldMax" DECIMAL(7,4),
  "strongestUnitTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetCustomers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "investmentAdvantages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "investmentRisks" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes" TEXT,
  "source" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectInvestmentProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectLandmark" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT,
  "locationId" TEXT,
  "distanceKm" DECIMAL(8,2),
  "estimatedMinutes" INTEGER,
  "distanceType" TEXT NOT NULL DEFAULT 'ADMIN_VERIFIED',
  "notes" TEXT,
  "source" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectLandmark_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProjectCompetitor" (
  "projectId" TEXT NOT NULL,
  "competitorProjectId" TEXT NOT NULL,
  "reason" TEXT,
  "notes" TEXT,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectCompetitor_pkey" PRIMARY KEY ("projectId", "competitorProjectId")
);

CREATE UNIQUE INDEX "Amenity_canonicalName_key" ON "Amenity"("canonicalName");
CREATE UNIQUE INDEX "ProjectInvestmentProfile_projectId_key" ON "ProjectInvestmentProfile"("projectId");
CREATE INDEX "DeveloperProjectPortfolio_developerId_status_idx" ON "DeveloperProjectPortfolio"("developerId", "status");
CREATE INDEX "DeveloperProjectPortfolio_locationId_idx" ON "DeveloperProjectPortfolio"("locationId");
CREATE INDEX "ProjectLandmark_projectId_category_idx" ON "ProjectLandmark"("projectId", "category");
CREATE INDEX "ProjectLandmark_locationId_idx" ON "ProjectLandmark"("locationId");

ALTER TABLE "LocationDistance" ADD CONSTRAINT "LocationDistance_verifiedByAdminId_fkey" FOREIGN KEY ("verifiedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeveloperProjectPortfolio" ADD CONSTRAINT "DeveloperProjectPortfolio_developerId_fkey" FOREIGN KEY ("developerId") REFERENCES "Developer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeveloperProjectPortfolio" ADD CONSTRAINT "DeveloperProjectPortfolio_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DeveloperProjectPortfolio" ADD CONSTRAINT "DeveloperProjectPortfolio_verifiedByAdminId_fkey" FOREIGN KEY ("verifiedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectAmenity" ADD CONSTRAINT "ProjectAmenity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAmenity" ADD CONSTRAINT "ProjectAmenity_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectInvestmentProfile" ADD CONSTRAINT "ProjectInvestmentProfile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectInvestmentProfile" ADD CONSTRAINT "ProjectInvestmentProfile_verifiedByAdminId_fkey" FOREIGN KEY ("verifiedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectLandmark" ADD CONSTRAINT "ProjectLandmark_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectLandmark" ADD CONSTRAINT "ProjectLandmark_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectCompetitor" ADD CONSTRAINT "ProjectCompetitor_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectCompetitor" ADD CONSTRAINT "ProjectCompetitor_competitorProjectId_fkey" FOREIGN KEY ("competitorProjectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
