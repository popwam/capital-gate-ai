import * as assert from "node:assert/strict";
import { test } from "node:test";
import { PropertySearchService } from "./property-search.service";
import { ApplicationCache } from "./cache/application-cache";
import { deterministicIntent } from "./providers/deterministic-intent";
import { normalizeRealEstateSemantics } from "./providers/real-estate-semantics";
import { applyDeterministicTurnSemantics, planCustomerTurn } from "./customer-turn-planner";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("location resolution checks multilingual canonical fields and approved aliases for controlled names", async () => {
  const queries: any[] = [];
  const prisma = { location: { findMany: async (query: any) => { queries.push(query); return query.where?.parentId ? [] : [{ id: "location" }]; } } };
  const service = new PropertySearchService(prisma as any);
  for (const term of ["التجمع", "التجمع الخامس", "القاهرة الجديدة", "New Cairo", "زايد", "الشيخ زايد"]) assert.deepEqual(await service.resolveLocations([term]), ["location"]);
  for (const query of queries.filter((item) => item.where?.OR)) {
    assert.ok(query.where.OR.some((item: any) => item.name));
    assert.ok(query.where.OR.some((item: any) => item.nameAr));
    assert.ok(query.where.OR.some((item: any) => item.nameEn));
    assert.ok(query.where.OR.some((item: any) => item.canonicalName));
    assert.ok(query.where.OR.some((item: any) => item.aliases?.some?.approvalStatus === "APPROVED"));
  }
});

test("controlled inventory seed keeps unit payment plans single-owned and approved Cairo/Zayed aliases in Git", () => {
  const source = readFileSync(resolve(process.cwd(), "../../scripts/seed-controlled-inventory.mjs"), "utf8");
  assert.doesNotMatch(source, /paymentPlan\.create\([^]*?unitId:\s*unit\.id[^]*?projectId:\s*project\.id/iu);
  assert.match(source, /"APT-301","Apartment",3,3,165,7900000,"AVAILABLE",8,2028/u);
  assert.match(source, /"APT-210","Apartment",3,2,155,8800000,"AVAILABLE",9,2029/u);
  assert.match(source, /unitId:\s*unit\.id[^]*?durationMonths:\s*years\s*\*\s*12/u);
  for (const alias of ["التجمع", "التجمع الخامس", "القاهرة الجديدة", "نيو كايرو", "new cairo", "fifth settlement", "زايد", "الشيخ زايد", "شيخ زايد", "sheikh zayed", "zayed"]) assert.match(source, new RegExp(alias, "iu"));
  assert.match(source, /approvalStatus:\s*"APPROVED"/u);
});

test("exact-unit payment lookup retains identity and rejects plans owned by another unit", async () => {
  const direct = [
    { id: "plan-301", unitId: "u301", projectId: null, phaseId: null, durationMonths: 96, isActive: true },
    { id: "stale-210", unitId: "u210", projectId: null, phaseId: null, durationMonths: 108, isActive: true },
  ];
  const prisma = {
    unit: { findFirst: async () => ({
      id: "u301", externalUnitId: "TEST-APT-301", projectId: "p-east", phaseId: null,
      price: 7_900_000, currency: "EGP", project: { name: "East Gardens Test", nameAr: null, nameEn: null }, paymentPlans: direct,
    }) },
    paymentPlan: { findMany: async () => [] },
  };
  const result = await new PropertySearchService(prisma as any).getPaymentPlanResult("u301");
  assert.equal(result.unit.externalUnitId, "TEST-APT-301");
  assert.equal(result.unit.projectName, "East Gardens Test");
  assert.deepEqual(result.plans.map((plan: any) => [plan.id, plan.durationMonths]), [["plan-301", 96]]);
});

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
  const prisma = { unit: { findMany: async (query: any) => { captured = query; return []; } } };
  const service = new PropertySearchService(prisma as any);
  await service.findUnitByExternalId("G60 4/2");
  assert.ok(captured.where.OR.every((candidate: any) => candidate.externalUnitId.equals === "G60 4/2"));
  assert.equal(captured.where.bedrooms, undefined);
  assert.equal(captured.where.bathrooms, undefined);
  assert.equal(captured.take, 2);
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

test("hard budget is filtered, validated, and ranked highest-within-budget before take", async () => {
  let query: any;
  const units = [4_100_000, 5_200_000, 4_950_000, 4_700_000].map((price, index) => ({
    id: `u${index}`, price, currency: "EGP", status: "AVAILABLE", archivedAt: null,
    projectId: "p1", project: { locationId: null, location: null }, developer: {}, paymentPlans: [], offers: [],
  }));
  const prisma = {
    location: { findMany: async () => [] },
    unit: {
      findMany: async (value: any) => { query = value; return units.filter((unit) => unit.price <= 5_000_000); },
      count: async () => 3,
    },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  const result = await new PropertySearchService(prisma as any).searchPropertiesWithMetadata({
    language: "ar-EG", budgetMax: 5_000_000, currency: "EGP", budgetStrictness: "HARD",
  }, 3);
  assert.deepEqual(query.where.price, { lte: 5_000_000 });
  assert.deepEqual(query.orderBy.slice(0, 2), [{ price: { sort: "desc", nulls: "last" } }, { id: "asc" }]);
  assert.deepEqual(result.properties.map((unit) => unit.price), [4_950_000, 4_700_000, 4_100_000]);
  assert.equal(result.properties.some((unit) => unit.price > 5_000_000), false);
  assert.deepEqual(result.properties.map((unit) => unit.canonicalPrice.source), ["UNIT_PRICE", "UNIT_PRICE", "UNIT_PRICE"]);
  assert.deepEqual({ total: result.totalExactMatches, returned: result.returnedCount, more: result.hasMore }, { total: 3, returned: 3, more: false });
});

test("approximate budget scores without becoming a hard database ceiling", async () => {
  let where: any;
  const unit = { id: "u1", price: 5_200_000, currency: "EGP", status: "AVAILABLE", archivedAt: null, projectId: "p1", project: { locationId: null, location: null }, developer: {}, paymentPlans: [], offers: [] };
  const prisma = {
    location: { findMany: async () => [] },
    unit: { findMany: async (query: any) => { where = query.where; return [unit]; }, count: async () => 1 },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  const result = await new PropertySearchService(prisma as any).searchPropertiesWithMetadata({ language: "ar-EG", budgetMax: 5_000_000, budgetStrictness: "APPROXIMATE" });
  assert.equal(where.price, undefined);
  assert.equal(result.properties[0]?.id, "u1");
});

test("verified payment objectives use resolved plans deterministically", async () => {
  const units = [
    { id: "u1", price: 4_900_000, downPayment: 900_000, installmentAmount: 50_000 },
    { id: "u2", price: 4_800_000, downPayment: 500_000, installmentAmount: 70_000 },
  ].map((unit) => ({ ...unit, currency: "EGP", status: "AVAILABLE", archivedAt: null, projectId: "p1", project: { locationId: null, location: null }, developer: {}, offers: [], paymentPlans: [{ id: `plan-${unit.id}`, unitId: unit.id, durationMonths: 96, downPaymentAmount: unit.downPayment, installmentAmount: unit.installmentAmount, installmentFrequency: "MONTHLY" }] }));
  const prisma = {
    location: { findMany: async () => [] }, unit: { findMany: async () => units },
    paymentPlan: { findMany: async () => [] }, unitMediaRule: { findMany: async () => [] },
  };
  const service = new PropertySearchService(prisma as any);
  assert.deepEqual((await service.searchProperties({ language: "ar-EG", queryObjective: "LOWEST_DOWN_PAYMENT" })).map((unit) => unit.id), ["u2", "u1"]);
  assert.deepEqual((await service.searchProperties({ language: "ar-EG", queryObjective: "LOWEST_INSTALLMENT" })).map((unit) => unit.id), ["u1", "u2"]);
});
