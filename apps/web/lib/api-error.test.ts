import assert from "node:assert/strict";
import test from "node:test";
import { adminErrorMessage, ApiRequestError } from "./api.ts";

test("Admin errors explain authentication, size, type and workbook failures", () => {
  assert.match(adminErrorMessage(new ApiRequestError("Unauthorized", 401, "UNAUTHENTICATED")), /session expired/i);
  assert.match(adminErrorMessage(new ApiRequestError("large", 413, "IMPORT_FILE_TOO_LARGE")), /20 MB/i);
  assert.match(adminErrorMessage(new ApiRequestError("type", 415, "IMPORT_UNSUPPORTED_FILE_TYPE")), /unsupported file type/i);
  assert.match(adminErrorMessage(new ApiRequestError("empty", 422, "IMPORT_NO_USABLE_SHEETS")), /no usable sheets/i);
});

test("Admin server errors retain the request ID", () => {
  assert.match(
    adminErrorMessage(new ApiRequestError("An unexpected error occurred.", 500, "INTERNAL_ERROR", "request-123")),
    /request-123/,
  );
});
