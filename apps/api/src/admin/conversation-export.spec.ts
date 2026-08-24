import * as assert from "node:assert/strict";
import { test } from "node:test";
import * as XLSX from "xlsx";
import {
  ConversationExportRecord,
  createConversationExport,
} from "./conversation-export";

const exportedAt = new Date("2026-08-24T10:00:00.000Z");
const records: ConversationExportRecord[] = [
  {
    id: "conversation-1",
    title: "=HYPERLINK(\"https://example.test\")",
    detectedLanguage: "ar",
    createdAt: new Date("2026-08-23T09:00:00.000Z"),
    updatedAt: new Date("2026-08-24T09:00:00.000Z"),
    state: { summary: { budget: { max: 5_000_000 } }, searchContext: {}, intentScore: 82 },
    leads: [
      {
        id: "lead-1",
        name: "أحمد",
        phone: "+201000000000",
        intent: "PURCHASE",
        intentScore: 82,
        status: "NEW",
        createdAt: new Date("2026-08-24T08:00:00.000Z"),
      },
    ],
    messages: [
      {
        id: "message-1",
        role: "USER",
        content: "عاوز وحدة في حدود 3-5 م\n```\n<script>alert(1)</script>",
        createdAt: new Date("2026-08-24T08:30:00.000Z"),
      },
    ],
  },
];

test("conversation JSON and Markdown exports preserve complete Arabic conversation data", () => {
  const json = createConversationExport(records, "json", { search: "أحمد" }, exportedAt);
  const parsed = JSON.parse(json.body.toString("utf8"));
  assert.equal(parsed.count, 1);
  assert.equal(parsed.conversations[0].messages[0].content.includes("عاوز وحدة"), true);

  const markdown = createConversationExport(records, "md", {}, exportedAt).body.toString("utf8");
  assert.match(markdown, /# تصدير المحادثات/u);
  assert.match(markdown, /عاوز وحدة/u);
  assert.match(markdown, /````/u);
});

test("spreadsheet exports neutralize formulas and Excel contains normalized sheets", () => {
  const csv = createConversationExport(records, "csv", {}, exportedAt).body.toString("utf8");
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /'=HYPERLINK/u);

  const xlsx = createConversationExport(records, "xlsx", {}, exportedAt);
  const workbook = XLSX.read(xlsx.body, { type: "buffer" });
  assert.deepEqual(workbook.SheetNames, ["Conversations", "Messages", "Leads"]);
  const conversations = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Conversations);
  assert.equal(conversations[0].title, `'${records[0].title}`);
  const messages = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Messages);
  assert.equal(messages[0].content, records[0].messages[0].content);
});
