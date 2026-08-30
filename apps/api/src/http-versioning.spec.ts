import "reflect-metadata";
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CustomerLifecycleController } from "./nadim-v2/product/customer-lifecycle.controller";
import { CustomerLifecycleService } from "./nadim-v2/product/customer-lifecycle.service";
import { NadimGatewayGuard } from "./nadim-v2/security/nadim-gateway.guard";
import { applyHttpVersioning } from "./http-versioning";

const calls: string[] = [];
const lifecycle = {
  recordHumanActivity: () => ({ recorded: true, mode: "HUMAN" }),
  releaseStaleHuman: () => ({ releasedCount: 0, released: [] }),
  claimDue: () => (calls.push("claim-due"), { tasks: [] }),
  markSent: () => ({ status: "SENT" }), markFailed: () => ({ status: "PENDING" }),
  createToken: () => ({}), consumeToken: () => ({}), revokeToken: () => ({}),
};

@Module({ controllers: [CustomerLifecycleController], providers: [NadimGatewayGuard, { provide: CustomerLifecycleService, useValue: lifecycle }] })
class VersioningTestModule {}

test("bootstrap exposes lifecycle contracts directly under /v2 and keeps gateway authentication", async () => {
  const previousSecret = process.env.NADIM_GATEWAY_SECRET;
  const previousEnabled = process.env.NADIM_V2_ENABLED;
  process.env.NADIM_GATEWAY_SECRET = "http-version-test-secret";
  process.env.NADIM_V2_ENABLED = "true";
  const app = await NestFactory.create(VersioningTestModule, { logger: false });
  applyHttpVersioning(app);
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address();
    assert.equal(typeof address, "object");
    const base = `http://127.0.0.1:${address.port}`;
    const unauthorized = await fetch(`${base}/v2/internal/followups/claim-due`, { method: "POST", headers: { "content-type": "application/json", "x-nadim-gateway-secret": "wrong" }, body: JSON.stringify({ workerId: "test", limit: 1 }) });
    assert.equal(unauthorized.status, 401);
    const valid = await fetch(`${base}/v2/internal/followups/claim-due`, { method: "POST", headers: { "content-type": "application/json", "x-nadim-gateway-secret": "http-version-test-secret" }, body: JSON.stringify({ workerId: "test", limit: 1 }) });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { tasks: [] });
    assert.ok(calls.includes("claim-due"));
    const accidental = await fetch(`${base}/v1/v2/internal/followups/claim-due`, { method: "POST", headers: { "content-type": "application/json", "x-nadim-gateway-secret": "http-version-test-secret" }, body: "{}" });
    assert.equal(accidental.status, 404);
  } finally {
    await app.close();
    if (previousSecret === undefined) delete process.env.NADIM_GATEWAY_SECRET; else process.env.NADIM_GATEWAY_SECRET = previousSecret;
    if (previousEnabled === undefined) delete process.env.NADIM_V2_ENABLED; else process.env.NADIM_V2_ENABLED = previousEnabled;
  }
});
