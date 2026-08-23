import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PropertySearchService } from "./property-search.service";
import { ApplicationCache } from "./cache/application-cache";
import { deterministicIntent } from "./providers/deterministic-intent";
import { normalizeRealEstateSemantics } from "./providers/real-estate-semantics";
import { applyDeterministicTurnSemantics, planCustomerTurn } from "./customer-turn-planner";

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
    paymentPlan: { findMany: async () => [] },
    unitMediaRule: { findMany: async () => [] },
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
  assert.ok(captured.where.OR.every((candidate: any) => candidate.externalUnitId.equals === "G60 4/2"));
  assert.equal(captured.where.bedrooms, undefined);
  assert.equal(captured.where.bathrooms, undefined);
});

test("contextual unit lookups cannot revive unavailable or archived candidates", async () => {
  let one: any;
  let many: any;
  const prisma = {
    unit: {
      findFirst: async (query: any) => { one = query; return null; },
      findMany: async (query: any) => { many = query; return []; },
    },
  };
  const service = new PropertySearchService(prisma as any);
  await assert.rejects(() => service.getProperty("u1"));
  await service.getUnitsByIds(["u1"]);
  assert.equal(one.where.status, "AVAILABLE");
  assert.equal(one.where.archivedAt, null);
  assert.equal(many.where.status, "AVAILABLE");
  assert.equal(many.where.archivedAt, null);
});

test("cheapest is a ranking objective over the effective verified result set", async () => {
  let query: any;
  const units = [12_000_000, 6_210_000, 9_000_000].map((price, index) => ({ id: `u${index}`, price, currency: "EGP", status: "AVAILABLE", projectId: "p1", project: { locationId: null, location: null }, developer: {}, paymentPlans: [], offers: [] }));
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (value: any) => { query = value; return units; } },
    paymentPlan: { findMany: async () => [] },
    unitMediaRule: { findMany: async () => [] },
  };
  const service = new PropertySearchService(prisma as any);
  const result = await service.searchProperties({ language: "ar-EG", queryObjective: "CHEAPEST" });
  assert.deepEqual(result.map((unit) => Number(unit.price)), [6_210_000, 9_000_000, 12_000_000]);
  assert.deepEqual(query.orderBy[0], { price: { sort: "asc", nulls: "last" } });
});

test("most expensive ordering is pushed into the database over all active filters", async () => {
  let query: any;
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (value: any) => { query = value; return []; } },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  await new PropertySearchService(prisma as any).searchProperties({ language: "ar-EG", queryObjective: "MOST_EXPENSIVE", propertyTypes: ["Villa"] });
  assert.deepEqual(query.orderBy[0], { price: { sort: "desc", nulls: "last" } });
  assert.deepEqual(query.where.unitType, { in: ["Villa"], mode: "insensitive" });
  assert.equal(query.where.status, "AVAILABLE");
  assert.equal(query.where.archivedAt, null);
});

test("purpose uses only admin-verified project suitability semantics", async () => {
  let query: any;
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (value: any) => { query = value; return []; } },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  await new PropertySearchService(prisma as any).searchProperties({ language: "ar-EG", purpose: "INVESTMENT" });
  assert.deepEqual(query.where.project.investmentProfile, { is: { verifiedAt: { not: null }, suitableForInvestment: true } });
});

test("no-match then explicit budget removal reruns inventory without the stale price filter", async () => {
  const unit = { id: "u1", price: 6_210_000, currency: "EGP", status: "AVAILABLE", projectId: "p1", project: { locationId: null, location: null }, developer: {}, paymentPlans: [], offers: [] };
  const seenWhere: any[] = [];
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (query: any) => { seenWhere.push(query.where); return query.where.price ? [] : [unit]; } },
    paymentPlan: { findMany: async () => [] },
    unitMediaRule: { findMany: async () => [] },
  };
  const service = new PropertySearchService(prisma as any);
  const constrained = { language: "ar-EG", budgetMax: 5_000_000, priceMax: 5_000_000 };
  assert.equal((await service.searchProperties(constrained)).length, 0);

  const source = "الغي الشرط ال 5 م";
  const plan = planCustomerTurn(source, constrained);
  const extracted = normalizeRealEstateSemantics(source, deterministicIntent([{ role: "user", content: source }], constrained), constrained);
  const relaxed = applyDeterministicTurnSemantics(source, extracted, constrained, plan);
  const recovered = await service.searchProperties(relaxed);
  assert.equal(relaxed.budgetMax, undefined);
  assert.equal(seenWhere.at(-1).price, undefined);
  assert.equal(recovered[0]?.id, "u1");
});

test("removing type and broadening location preserves the verified 3-5M query", async () => {
  let capturedWhere: any;
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (query: any) => { capturedWhere = query.where; return []; } },
    paymentPlan: { findMany: async () => [] },
    unitMediaRule: { findMany: async () => [] },
  };
  const service = new PropertySearchService(prisma as any);
  const previous = { language: "ar-EG", budgetMin: 3_000_000, budgetMax: 5_000_000, propertyTypes: ["Clinics"], locations: ["القاهرة"] };
  const source = "شيل النوع ووسع المنطقة";
  const plan = planCustomerTurn(source, previous);
  const extracted = normalizeRealEstateSemantics(source, deterministicIntent([{ role: "user", content: source }], previous), previous);
  const effective = applyDeterministicTurnSemantics(source, extracted, previous, plan);
  await service.searchProperties(effective);

  assert.equal(effective.budgetMin, 3_000_000);
  assert.equal(effective.budgetMax, 5_000_000);
  assert.equal(effective.propertyTypes, undefined);
  assert.equal(effective.locations, undefined);
  assert.deepEqual(capturedWhere.price, { gte: 3_000_000, lte: 5_000_000 });
  assert.equal(capturedWhere.unitType, undefined);
});
