import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import searchModule from "../apps/api/dist/property-search.service.js";

const { PropertySearchService } = searchModule;
const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 10);
let developerId, locationId, projectId;
try {
  const developer = await prisma.developer.create({ data: { name: `AI Search Smoke ${suffix}`, slug: `ai-search-smoke-${suffix}` } }); developerId = developer.id;
  const location = await prisma.location.create({ data: { name: `AI Search Area ${suffix}`, slug: `ai-search-area-${suffix}`, type: "AREA" } }); locationId = location.id;
  const project = await prisma.project.create({ data: { name: `AI Search Project ${suffix}`, slug: `ai-search-project-${suffix}`, developerId, locationId } }); projectId = project.id;
  await prisma.unit.createMany({ data: [150.96, 155.67, 170].map((builtUpArea, index) => ({ externalUnitId: `AI-${suffix}-${index}`, developerId, projectId, builtUpArea, price: 10_000_000 + index, currency: "EGP", status: "AVAILABLE" })) });
  const service = new PropertySearchService(prisma);
  const aggregate = await service.aggregateInventory({ language: "ar-EG", temporaryIntent: "INVENTORY_AGGREGATION", aggregationDimension: "BUILT_UP_AREA", builtUpAreaMin: 100, preferredProjects: [project.name] });
  assert.deepEqual(aggregate.values, [150.96, 155.67, 170]);
  console.log(JSON.stringify({ postgresAggregation: "PASS", builtUpAreaFilterRetained: "PASS", verifiedValues: aggregate.values }));
} finally {
  if (projectId) await prisma.unit.deleteMany({ where: { projectId } });
  if (projectId) await prisma.project.deleteMany({ where: { id: projectId } });
  if (locationId) await prisma.location.deleteMany({ where: { id: locationId } });
  if (developerId) await prisma.developer.deleteMany({ where: { id: developerId } });
  await prisma.$disconnect();
}
