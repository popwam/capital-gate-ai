import * as assert from "node:assert/strict";
import { test } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { SafeHttpExceptionFilter } from "./http-exception.filter";

function invoke(error: unknown) {
  let status = 0;
  let body: any;
  const response = {
    status(value: number) { status = value; return this; },
    json(value: unknown) { body = value; return this; },
  };
  const host: any = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({
        requestId: "request-1",
        method: "POST",
        originalUrl: "/v1/admin/imports/upload",
      }),
    }),
  };
  new SafeHttpExceptionFilter().catch(error, host);
  return { status, body };
}

test("Multer file-size failures become structured 413 responses", () => {
  const result = invoke({ code: "LIMIT_FILE_SIZE" });
  assert.equal(result.status, 413);
  assert.equal(result.body.code, "IMPORT_FILE_TOO_LARGE");
  assert.equal(result.body.requestId, "request-1");
});

test("authentication errors remain clear without exposing internals", () => {
  const result = invoke(new UnauthorizedException());
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "UNAUTHENTICATED");
});

test("unknown server failures retain request ID and hide internals", () => {
  const result = invoke(new Error("database password must never surface"));
  assert.equal(result.status, 500);
  assert.equal(result.body.code, "INTERNAL_ERROR");
  assert.equal(result.body.message, "An unexpected error occurred.");
  assert.equal(result.body.requestId, "request-1");
});
