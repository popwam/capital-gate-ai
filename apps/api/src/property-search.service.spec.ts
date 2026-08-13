import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PropertySearchService } from "./property-search.service";

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
