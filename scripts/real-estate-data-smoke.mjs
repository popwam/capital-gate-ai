import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const prisma = new PrismaClient();
const tag = `codex-smoke-${randomUUID()}`;
let developerId, countryId, areaId, amenityId;
const projectIds = [];
try {
  const country = await prisma.location.create({ data: { type: "COUNTRY", name: `Test Country ${tag}`, slug: `${tag}-country`, canonicalName: "Fixture Country", source: "ISOLATED_SMOKE_TEST" } });
  countryId = country.id;
  const area = await prisma.location.create({ data: { type: "AREA", name: `Test Area ${tag}`, slug: `${tag}-area`, parentId: country.id, nameAr: "منطقة اختبار", source: "ISOLATED_SMOKE_TEST" } });
  areaId = area.id;
  const developer = await prisma.developer.create({ data: { name: `Developer ${tag}`, slug: `${tag}-developer`, canonicalName: "Fixture Developer", nameAr: "مطور اختبار", specialties: ["RESIDENTIAL"], geographicFocus: ["Fixture Area"], yearsInMarket: 10 } });
  developerId = developer.id;
  const project = await prisma.project.create({ data: { developerId: developer.id, locationId: area.id, name: `Project ${tag}`, slug: `${tag}-project`, canonicalName: "Fixture Project", nameAr: "مشروع اختبار", adminStatus: "READY_FOR_CUSTOMER", projectType: "RESIDENTIAL", unitTypes: ["APARTMENT"], customerFit: ["FAMILY"], finishingOptions: ["FINISHED"] } });
  projectIds.push(project.id);
  const competitor = await prisma.project.create({ data: { developerId: developer.id, locationId: area.id, name: `Competitor ${tag}`, slug: `${tag}-competitor`, adminStatus: "DRAFT" } });
  projectIds.push(competitor.id);
  await prisma.developerProjectPortfolio.create({ data: { developerId: developer.id, projectName: "Delivered Fixture", status: "DELIVERED", deliveryYear: 2020, locationId: area.id, source: "ISOLATED_SMOKE_TEST", verifiedAt: new Date() } });
  const amenity = await prisma.amenity.create({ data: { canonicalName: tag, nameAr: "نادي", category: "LEISURE" } });
  amenityId = amenity.id;
  await prisma.projectAmenity.create({ data: { projectId: project.id, amenityId: amenity.id, verified: true, source: "ISOLATED_SMOKE_TEST" } });
  await prisma.projectInvestmentProfile.create({ data: { projectId: project.id, suitableForLiving: true, suitableForInvestment: true, resaleDemand: "MEDIUM", investmentAdvantages: ["Verified fixture"], source: "ISOLATED_SMOKE_TEST", verifiedAt: new Date() } });
  await prisma.projectLandmark.create({ data: { projectId: project.id, name: "Fixture University", category: "UNIVERSITY", distanceKm: 4.2, estimatedMinutes: 9, distanceType: "ADMIN_VERIFIED", source: "ISOLATED_SMOKE_TEST", verifiedAt: new Date() } });
  await prisma.projectCompetitor.create({ data: { projectId: project.id, competitorProjectId: competitor.id, verified: true, source: "ISOLATED_SMOKE_TEST" } });
  const loaded = await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: { developer: { include: { portfolioProjects: true } }, location: true, amenities: { include: { amenity: true } }, investmentProfile: true, landmarks: true, competitorsFrom: true } });
  assert.equal(loaded.adminStatus, "READY_FOR_CUSTOMER");
  assert.equal(loaded.amenities.length, 1);
  assert.equal(loaded.landmarks[0].distanceType, "ADMIN_VERIFIED");
  assert.equal(loaded.developer.portfolioProjects[0].status, "DELIVERED");
  assert.equal(loaded.investmentProfile?.resaleDemand, "MEDIUM");
  assert.equal(loaded.competitorsFrom.length, 1);
  console.log("Canonical real-estate isolated fixture: PASS");
} finally {
  if (projectIds.length) await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
  if (developerId) await prisma.developer.delete({ where: { id: developerId } }).catch(() => undefined);
  if (amenityId) await prisma.amenity.delete({ where: { id: amenityId } }).catch(() => undefined);
  if (areaId) await prisma.location.delete({ where: { id: areaId } }).catch(() => undefined);
  if (countryId) await prisma.location.delete({ where: { id: countryId } }).catch(() => undefined);
  const residual = await Promise.all([
    prisma.location.count({ where: { source: "ISOLATED_SMOKE_TEST", slug: { startsWith: tag } } }),
    prisma.developerProjectPortfolio.count({ where: { source: "ISOLATED_SMOKE_TEST", developerId: developerId ?? "none" } }),
    prisma.projectLandmark.count({ where: { source: "ISOLATED_SMOKE_TEST", projectId: { in: projectIds } } }),
  ]);
  assert.deepEqual(residual, [0, 0, 0], "isolated fixture cleanup left residual records");
  await prisma.$disconnect();
}
