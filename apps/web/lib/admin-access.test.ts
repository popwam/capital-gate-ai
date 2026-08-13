import assert from "node:assert/strict";
import test from "node:test";
import { adminAccessDecision, normalizeAdminAccessPath, validAdminAccessPath } from "./admin-access.ts";

const secret = "0123456789abcdef0123456789abcdef";

test("production Admin routes are non-disclosing until authenticated", () => {
  assert.equal(adminAccessDecision({ pathname: "/admin", configuredPath: `control/${secret}`, production: true, authenticated: false }), "NOT_FOUND");
  assert.equal(adminAccessDecision({ pathname: "/admin/login", configuredPath: `control/${secret}`, production: true, authenticated: false }), "NOT_FOUND");
  assert.equal(adminAccessDecision({ pathname: "/admin", configuredPath: `control/${secret}`, production: true, authenticated: true }), "ALLOW_ADMIN");
});

test("only the exact server-side private path opens the entry and wrong paths pass to 404", () => {
  assert.equal(adminAccessDecision({ pathname: `/control/${secret}`, configuredPath: `/control/${secret}/`, production: true, authenticated: false }), "PRIVATE_ENTRY");
  assert.equal(adminAccessDecision({ pathname: "/control/wrong", configuredPath: `control/${secret}`, production: true, authenticated: false }), "PASS");
  assert.equal(normalizeAdminAccessPath("/control/secret/"), "control/secret");
  assert.equal(validAdminAccessPath("control/weak"), "");
});

test("local development keeps /admin usable when no private path is configured", () => {
  assert.equal(adminAccessDecision({ pathname: "/admin", production: false, authenticated: false }), "LOCAL_LOGIN");
});
