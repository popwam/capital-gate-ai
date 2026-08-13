import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PropertySearchService } from "./property-search.service";
import { ApplicationCache } from "./cache/application-cache";

test("built-up-area aggregation is database-backed and keeps the prior minimum filter", async () => {
  let capturedWhere: any;
  const prisma = { location: { findMany: async () => [] }, unit: { findMany: async (query: any) => { capturedWhere = query.where; return [{ builtUpArea: 150.96 }, { builtUpArea: 155.67 }, { builtUpArea: 170 }]; } } };
  const service = new PropertySearchService(prisma as any);
  const result = await service.aggregateInventory({ language: "ar-EG", temporaryIntent: "INVENTORY_AGGREGATION", aggregationDimension: "BUILT_UP_AREA", builtUpAreaMin: 100 });
  assert.equal((capturedWhere.builtUpArea as any).gte, 100);
  assert.deepEqual(result.values, [150.96, 155.67, 170]);
});

test("normalized trace filters distinguish unit area from location IDs", async () => {
  const prisma = { location: { findMany: async () => [{ id: "new-cairo" }] } };
  const service = new PropertySearchService(prisma as any);
  const filters = await service.normalizedSearchFilters({ language: "ar-EG", builtUpAreaMin: 100, locations: ["التجمع"] });
  assert.equal(filters.builtUpAreaMin, 100);
  assert.deepEqual(filters.locationIds, ["new-cairo"]);
});

test("developer history is retrieved as structured verified portfolio data", async () => {
  let query: any;
  const prisma = { developer: { findUnique: async (args: any) => { query = args; return { id: "developer-1", portfolioProjects: [{ projectName: "Delivered", status: "DELIVERED", verifiedAt: new Date() }], projects: [] }; } } };
  const service = new PropertySearchService(prisma as any);
  const result: any = await service.getDeveloper("developer-1");
  assert.equal(result.portfolioProjects[0].status, "DELIVERED");
  assert.deepEqual(query.include.portfolioProjects.where, { verifiedAt: { not: null } });
});

test("normalized searches hit cache and inventory invalidation forces fresh results", async () => {
  let queries = 0;
  const unit = { id: "u1", price: 10_000_000, currency: "EGP", status: "AVAILABLE", projectId: "p1", project: { locationId: null, location: null }, developer: {}, paymentPlans: [], offers: [] };
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async () => { queries++; return [unit]; } },
  };
  const cache = new ApplicationCache();
  const service = new PropertySearchService(prisma as any, cache);
  const intent = { language: "en", budgetMax: 10_000_000 };
  await service.searchProperties(intent);
  await service.searchProperties(intent);
  assert.equal(queries, 1);
  cache.invalidateCustomerData();
  await service.searchProperties(intent);
  assert.equal(queries, 2);
});

test("exact external unit lookup takes the identifier as one atomic value", async () => {
  let captured: any;
  const prisma = { unit: { findFirst: async (query: any) => { captured = query; return null; } } };
  const service = new PropertySearchService(prisma as any);
  await service.findUnitByExternalId("G60 4/2");
  assert.equal(captured.where.externalUnitId.equals, "G60 4/2");
  assert.equal(captured.where.bedrooms, undefined);
  assert.equal(captured.where.bathrooms, undefined);
});
