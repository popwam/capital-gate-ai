import * as XLSX from "xlsx";
import type { ConversationExportFormat } from "./lead-crm.dto";

export type ConversationExportRecord = {
  id: string;
  title: string | null;
  detectedLanguage: string | null;
  createdAt: Date;
  updatedAt: Date;
  state: {
    summary: unknown;
    searchContext: unknown;
    intentScore: number;
  } | null;
  leads: Array<{
    id: string;
    name: string;
    phone: string;
    intent: string;
    intentScore: number;
    status: string;
    createdAt: Date;
  }>;
  messages: Array<{
    id: string;
    role: string;
    content: string;
    createdAt: Date;
  }>;
};

export type ConversationExportFilters = {
  search?: string;
  intent?: string;
};

export type ConversationExportFile = {
  body: Buffer;
  contentType: string;
  fileName: string;
};

function iso(value: Date) {
  return value.toISOString();
}

function json(value: unknown) {
  return value == null ? "" : JSON.stringify(value);
}

function inlineMarkdown(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/[\r\n]+/g, " ")
    .replace(/([\\`*_{}\[\]()#+.!|~-])/g, "\\$1")
    .trim();
}

function fencedText(value: string) {
  const longestRun = Math.max(0, ...Array.from(value.matchAll(/`+/g), (match) => match[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${value}\n${fence}`;
}

function spreadsheetSafe(value: unknown) {
  if (typeof value !== "string") return value;
  return /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
}

function conversationRows(records: ConversationExportRecord[]) {
  return records.map((item) => ({
    conversationId: item.id,
    title: spreadsheetSafe(item.title ?? ""),
    detectedLanguage: spreadsheetSafe(item.detectedLanguage ?? ""),
    createdAt: iso(item.createdAt),
    updatedAt: iso(item.updatedAt),
    messageCount: item.messages.length,
    leadCount: item.leads.length,
    conversationIntentScore: item.state?.intentScore ?? "",
    summary: spreadsheetSafe(json(item.state?.summary)),
    searchContext: spreadsheetSafe(json(item.state?.searchContext)),
    leads: spreadsheetSafe(json(item.leads)),
    messages: spreadsheetSafe(json(item.messages)),
  }));
}

function messageRows(records: ConversationExportRecord[]) {
  return records.flatMap((item) =>
    item.messages.map((message) => ({
      conversationId: item.id,
      conversationTitle: spreadsheetSafe(item.title ?? ""),
      messageId: message.id,
      role: message.role,
      content: spreadsheetSafe(message.content),
      createdAt: iso(message.createdAt),
    })),
  );
}

function leadRows(records: ConversationExportRecord[]) {
  return records.flatMap((item) =>
    item.leads.map((lead) => ({
      conversationId: item.id,
      conversationTitle: spreadsheetSafe(item.title ?? ""),
      leadId: lead.id,
      name: spreadsheetSafe(lead.name),
      phone: spreadsheetSafe(lead.phone),
      intent: lead.intent,
      intentScore: lead.intentScore,
      status: lead.status,
      createdAt: iso(lead.createdAt),
    })),
  );
}

function csvCell(value: unknown) {
  const text = String(spreadsheetSafe(value ?? ""));
  return `"${text.replace(/"/g, '""')}"`;
}

function csv(records: ConversationExportRecord[]) {
  const rows = conversationRows(records);
  const headers = [
    "conversationId",
    "title",
    "detectedLanguage",
    "createdAt",
    "updatedAt",
    "messageCount",
    "leadCount",
    "conversationIntentScore",
    "summary",
    "searchContext",
    "leads",
    "messages",
  ] as const;
  return [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\r\n");
}

function markdown(records: ConversationExportRecord[], filters: ConversationExportFilters, exportedAt: Date) {
  const lines = [
    "# تصدير المحادثات",
    "",
    `- تاريخ التصدير: ${exportedAt.toISOString()}`,
    `- عدد المحادثات: ${records.length}`,
  ];
  if (filters.search) lines.push(`- البحث: ${inlineMarkdown(filters.search)}`);
  if (filters.intent) lines.push(`- نية العميل: ${inlineMarkdown(filters.intent)}`);

  for (const item of records) {
    lines.push(
      "",
      `## ${inlineMarkdown(item.title || "محادثة بدون عنوان")}`,
      "",
      `- المعرّف: ${inlineMarkdown(item.id)}`,
      `- اللغة: ${inlineMarkdown(item.detectedLanguage || "غير محددة")}`,
      `- أُنشئت: ${iso(item.createdAt)}`,
      `- آخر تحديث: ${iso(item.updatedAt)}`,
      `- عدد الرسائل: ${item.messages.length}`,
      `- عدد الفرص: ${item.leads.length}`,
    );
    if (item.state) {
      lines.push("", "### حالة المحادثة", "", fencedText(JSON.stringify(item.state, null, 2)));
    }
    if (item.leads.length) {
      lines.push("", "### الفرص المرتبطة");
      for (const lead of item.leads) {
        lines.push(
          "",
          `- ${inlineMarkdown(lead.name)} — ${inlineMarkdown(lead.phone)} — ${inlineMarkdown(lead.intent)} — ${inlineMarkdown(lead.status)} — ${lead.intentScore}/100`,
        );
      }
    }
    lines.push("", "### الرسائل");
    if (!item.messages.length) lines.push("", "لا توجد رسائل.");
    for (const message of item.messages) {
      lines.push(
        "",
        `#### ${message.role === "USER" ? "العميل" : message.role === "ASSISTANT" ? "المستشار" : inlineMarkdown(message.role)} — ${iso(message.createdAt)}`,
        "",
        fencedText(message.content),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

function excel(records: ConversationExportRecord[]) {
  const workbook = XLSX.utils.book_new();
  const sheets = [
    ["Conversations", conversationRows(records)],
    ["Messages", messageRows(records)],
    ["Leads", leadRows(records)],
  ] as const;
  for (const [name, rows] of sheets) {
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{}], { skipHeader: false });
    XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
}

export function createConversationExport(
  records: ConversationExportRecord[],
  format: ConversationExportFormat,
  filters: ConversationExportFilters,
  exportedAt = new Date(),
): ConversationExportFile {
  const stem = `conversations-${exportedAt.toISOString().slice(0, 10)}`;
  if (format === "xlsx") {
    return {
      body: excel(records),
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileName: `${stem}.xlsx`,
    };
  }
  if (format === "csv") {
    return {
      body: Buffer.from(`\uFEFF${csv(records)}`, "utf8"),
      contentType: "text/csv; charset=utf-8",
      fileName: `${stem}.csv`,
    };
  }
  if (format === "md") {
    return {
      body: Buffer.from(markdown(records, filters, exportedAt), "utf8"),
      contentType: "text/markdown; charset=utf-8",
      fileName: `${stem}.md`,
    };
  }
  return {
    body: Buffer.from(
      JSON.stringify(
        {
          exportedAt: exportedAt.toISOString(),
          filters,
          count: records.length,
          conversations: records,
        },
        null,
        2,
      ),
      "utf8",
    ),
    contentType: "application/json; charset=utf-8",
    fileName: `${stem}.json`,
  };
}
