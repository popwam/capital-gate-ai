import * as assert from "node:assert/strict";
import { test } from "node:test";
import { AutomationSecretGuard } from "./automation-secret.guard";

function context(secret?: string) {
  return { switchToHttp: () => ({ getRequest: () => ({ headers: secret ? { "x-nadim-automation-secret": secret } : {} }) }) } as any;
}

test("automation guard rejects a missing secret", () => {
  assert.throws(() => new AutomationSecretGuard("local-test-secret").canActivate(context()), (error: any) => error.getResponse().error.code === "UNAUTHORIZED");
});

test("automation guard rejects a wrong secret", () => {
  assert.throws(() => new AutomationSecretGuard("local-test-secret").canActivate(context("wrong")), (error: any) => error.getResponse().error.code === "UNAUTHORIZED");
});

test("automation guard accepts the configured secret", () => {
  assert.equal(new AutomationSecretGuard("local-test-secret").canActivate(context("local-test-secret")), true);
});

test("automation guard fails initialization without configuration", () => {
  assert.throws(() => new AutomationSecretGuard("").onModuleInit(), /must be configured/);
});
