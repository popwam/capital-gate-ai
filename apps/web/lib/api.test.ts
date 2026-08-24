import assert from "node:assert/strict";
import test from "node:test";
import { downloadFileName } from "./api.ts";

test("downloadFileName reads plain and UTF-8 content disposition filenames", () => {
  assert.equal(
    downloadFileName('attachment; filename="conversations-2026-08-24.xlsx"', "fallback.xlsx"),
    "conversations-2026-08-24.xlsx",
  );
  assert.equal(
    downloadFileName("attachment; filename*=UTF-8''%D9%85%D8%AD%D8%A7%D8%AF%D8%AB%D8%A7%D8%AA.json", "fallback.json"),
    "محادثات.json",
  );
});

test("downloadFileName falls back for missing or malformed headers", () => {
  assert.equal(downloadFileName(null, "conversations.csv"), "conversations.csv");
  assert.equal(downloadFileName("attachment; filename*=UTF-8''%ZZ", "conversations.csv"), "conversations.csv");
});
