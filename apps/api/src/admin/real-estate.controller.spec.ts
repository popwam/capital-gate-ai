import * as assert from "node:assert/strict";
import { test } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { RealEstateController } from "./real-estate.controller";
import { ApplicationCache } from "../cache/application-cache";

function fixture() {
  const calls: any[] = [];
  const prisma: any = {
    unit: { count: (args: any) => Promise.resolve(args.where.phaseId === null ? 0 : args.where.masterPlanLocationStatus ? 6 : args.where.status ? 7 : 12) },
    project: { count: async (args?: any) => args?.where?.boundaryConfirmedAt ? 2 : 3, findUniqueOrThrow: async (args: any) => { calls.push(["project.find", args]); return args.include?.amenities?.where ? { id: "p1", nameAr: "مشروع", locationId: "area-1", projectType: "RESIDENTIAL", deliveryStatus: "PLANNED", priceSummary: "Verified", paymentSummary: "Verified", shortDescriptionAr: "وصف", latitude: 30, longitude: 31, location: null, amenities: [{ amenityId: "a1" }], investmentProfile: { verifiedAt: new Date() } } : { id: "p1" }; } },
    media: { count: async () => 3 },
    projectPhase: { count: async () => 1 },
    paymentPlan: { count: async () => 2 },
    marketProfile: { count: async () => 1 },
    projectKnowledgeItem: { count: async () => 0 },
    conversation: { count: async () => 9 },
    developer: { count: async () => 2 },
    dataImport: { count: async (args: any) => args.where.status === "NEEDS_INPUT" ? 1 : 2 },
    lead: { count: async (args: any) => args.where.status === "NEW" ? 4 : 5 },
    projectInvestmentProfile: { upsert: async (args: any) => { calls.push(["investment.upsert", args]); return { id: "investment-1", ...args.create }; } },
    $transaction: async (items: Promise<unknown>[]) => Promise.all(items),
  };
  const audit: any = { record: async (...args: any[]) => calls.push(["audit", args]) };
  const cache = { invalidateCustomerData: () => undefined } as ApplicationCache;

  return {
    controller: new RealEstateController(prisma, audit, cache),
    calls,
  };
}

test("canonical real-estate routes are protected by AdminAuthGuard", () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, RealEstateController) ?? [];
  assert.ok(guards.includes(AdminAuthGuard));
});

test("dashboard returns summary cards without loading management tables", async () => {
  const { controller } = fixture();
  assert.deepEqual(await controller.dashboard(), { units: 12, availableUnits: 7, reservedUnits: 7, soldUnits: 7, unavailableUnits: 7, projects: 3, developers: 2, activeImports: 2, importsNeedingInput: 1, newLeads: 4, followUps: 5, mappedUnits: 6, projectsWithBoundary: 2, activePaymentPlans: 2, pendingKnowledge: 0, conversations24h: 9 });
});

test("investment facts are explicitly Admin-verified and audited", async () => {
  const { controller, calls } = fixture();
  const result: any = await controller.investment("p1", { suitableForInvestment: true, resaleDemand: "HIGH", source: "Admin research" }, { admin: { id: "admin-1" } });
  assert.equal(result.verifiedByAdminId, "admin-1");
  assert.ok(result.verifiedAt instanceof Date);
  assert.ok(calls.some(([name]) => name === "audit"));
});

test("project detail contract includes canonical structured relations", async () => {
  const { controller, calls } = fixture();
  await controller.project("p1");
  const include = calls.find(([name]) => name === "project.find")[1].include;
  assert.ok(include.amenities && include.investmentProfile && include.landmarks && include.competitorsFrom && include.media && include.documents);
});

test("customer readiness requires at least three project images", async () => {
  const { controller } = fixture();
  const readiness = await controller.readiness("p1");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.imageCount, 3);
});
