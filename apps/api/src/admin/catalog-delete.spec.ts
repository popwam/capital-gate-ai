import * as assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { CatalogController } from "./catalog.controller";

function fixture(input: {
  developerCounts?: Record<string, number>;
  projectCounts?: Record<string, number>;
} = {}) {
  const calls: string[] = [];
  const emptyDeveloper = { projects: 0, units: 0, media: 0, documents: 0, imports: 0, importSheets: 0 };
  const emptyProject = { units: 0, media: 0, documents: 0, imports: 0, importSheets: 0 };
  const prisma: any = {
    developer: {
      findUniqueOrThrow: async () => ({ name: "Canonical Developer", nameAr: "المطور العربي", nameEn: null, brandName: "CG Developer", _count: { ...emptyDeveloper, ...input.developerCounts } }),
      delete: async () => { calls.push("developer.delete"); return { id: "developer-1" }; },
    },
    project: {
      findUniqueOrThrow: async () => ({ name: "Canonical Project", nameAr: "المشروع العربي", nameEn: null, _count: { ...emptyProject, ...input.projectCounts } }),
      delete: async () => { calls.push("project.delete"); return { id: "project-1" }; },
    },
  };
  const audit: any = { record: async (_adminId: string, action: string) => { calls.push(action); } };
  const cache: any = { invalidateCustomerData: () => { calls.push("cache.invalidate"); } };
  const controller = new CatalogController(prisma, audit, {} as any, cache);
  return { controller, calls };
}

test("an empty developer can be deleted using any visible canonical name", async () => {
  const { controller, calls } = fixture();
  assert.deepEqual(await controller.deleteDeveloper("developer-1", { confirmation: "CG Developer" }, { admin: { id: "admin-1" } }), { deleted: true });
  assert.deepEqual(calls, ["developer.delete", "DEVELOPER_DELETED", "cache.invalidate"]);
});

test("developer deletion is blocked while commercial or stored dependencies remain", async () => {
  const { controller, calls } = fixture({ developerCounts: { projects: 2, units: 12, media: 1 } });
  await assert.rejects(
    () => controller.deleteDeveloper("developer-1", { confirmation: "المطور العربي" }, { admin: { id: "admin-1" } }),
    (error: unknown) => error instanceof ConflictException
      && (error.getResponse() as { code?: string }).code === "DEVELOPER_DELETE_BLOCKED",
  );
  assert.deepEqual(calls, []);
});

test("an empty project can be deleted and the mutation is audited", async () => {
  const { controller, calls } = fixture();
  assert.deepEqual(await controller.deleteProject("project-1", { confirmation: "المشروع العربي" }, { admin: { id: "admin-1" } }), { deleted: true });
  assert.deepEqual(calls, ["project.delete", "PROJECT_DELETED", "cache.invalidate"]);
});

test("project deletion requires the exact displayed name", async () => {
  const { controller, calls } = fixture();
  await assert.rejects(
    () => controller.deleteProject("project-1", { confirmation: "DELETE" }, { admin: { id: "admin-1" } }),
    (error: unknown) => error instanceof BadRequestException
      && (error.getResponse() as { code?: string }).code === "DELETE_CONFIRMATION_MISMATCH",
  );
  assert.deepEqual(calls, []);
});

test("project deletion preserves a project that still owns inventory or import history", async () => {
  const { controller, calls } = fixture({ projectCounts: { units: 4, imports: 1 } });
  await assert.rejects(
    () => controller.deleteProject("project-1", { confirmation: "Canonical Project" }, { admin: { id: "admin-1" } }),
    (error: unknown) => error instanceof ConflictException
      && (error.getResponse() as { code?: string }).code === "PROJECT_DELETE_BLOCKED",
  );
  assert.deepEqual(calls, []);
});
