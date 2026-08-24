import * as assert from "node:assert/strict";
import { test } from "node:test";
import { HealthController } from "./health/health.controller";

test("health returns the private service identity after a database check", async () => {
  let checked = false;
  const controller = new HealthController({ $queryRaw: async () => { checked = true; return [{ ok: 1 }]; } } as any);
  assert.deepEqual(await controller.status(), { status: "ok", service: "nadim-automation-api" });
  assert.equal(checked, true);
});
