import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import * as XLSX from "xlsx";

if (!process.env.DATABASE_URL && process.loadEnvFile) {
  try { process.loadEnvFile(".env"); } catch { /* CI provides environment directly */ }
}

const required = [
  "ADMIN_BOOTSTRAP_EMAIL",
  "ADMIN_BOOTSTRAP_PASSWORD",
  "DATABASE_URL",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
];
for (const key of required) assert.ok(process.env[key], `${key} is required`);

const base = (process.env.IMPORT_SMOKE_API_URL || "http://127.0.0.1:4100").replace(/\/$/, "") + "/v1";
const origin = process.env.WEB_ORIGIN || "https://ai.cg.popwam.com";
const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const prisma = new PrismaClient();
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const importIds = [];
const objectKeys = [];
let cookie = "";

function bookBuffer(rows, bookType = "xlsx", sheetName = "Inventory") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType });
}

async function request(path, { method = "GET", body } = {}) {
  const jsonBody = typeof body === "string";
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(jsonBody ? { "content-type": "application/json" } : {}) },
    body,
    credentials: "include",
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function track(item) {
  if (item?.id) importIds.push(item.id);
  const prefix = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/`;
  if (item?.fileUrl?.startsWith(prefix)) objectKeys.push(decodeURIComponent(item.fileUrl.slice(prefix.length)));
}

async function upload(name, buffer, mime = "application/octet-stream") {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime }), name);
  const result = await request("/admin/imports/upload", { method: "POST", body: form });
  if (result.response.ok) track(result.data);
  return result;
}

async function main() {
  const preflight = await fetch(`${base}/admin/imports/upload`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
  assert.equal(preflight.headers.get("access-control-allow-credentials"), "true");

  const unauthenticatedForm = new FormData();
  unauthenticatedForm.append(
    "file",
    new Blob([bookBuffer([{ "Unit Number": "UNAUTH" }])]),
    `unauthenticated-${stamp}.xlsx`,
  );
  const unauthenticated = await fetch(`${base}/admin/imports/upload`, {
    method: "POST",
    headers: { Origin: origin },
    body: unauthenticatedForm,
    credentials: "include",
  });
  const unauthenticatedBody = await unauthenticated.json();
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticatedBody.code, "UNAUTHENTICATED");

  const login = await fetch(`${base}/admin/auth/login`, {
    method: "POST",
    headers: { Origin: origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_BOOTSTRAP_EMAIL,
      password: process.env.ADMIN_BOOTSTRAP_PASSWORD,
    }),
    credentials: "include",
  });
  assert.ok(login.ok, `Admin login failed: ${login.status}`);
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^maqar_admin_session=/);

  const xlsx = await upload(
    `import-smoke-${stamp}.xlsx`,
    bookBuffer([{ "Unit Number": `XLSX-${stamp}`, Price: 9_000_000, Currency: "EGP", "Unknown Sales Label": "Garden" }]),
  );
  assert.equal(xlsx.response.status, 201);
  assert.equal(xlsx.data.status, "NEEDS_INPUT");
  assert.ok(xlsx.data.issues.some((issue) => issue.field === "aiMapping"));
  assert.ok(xlsx.data.issues.some((issue) => issue.field === "column:Unknown Sales Label"));
  assert.equal((await fetch(xlsx.data.fileUrl)).status, 200);

  const xls = await upload(
    `import-smoke-${stamp}.xls`,
    bookBuffer([{ "Unit Number": `XLS-${stamp}`, Currency: "EGP" }], "biff8"),
    "application/vnd.ms-excel",
  );
  assert.equal(xls.response.status, 201);

  const csv = await upload(
    `import-smoke-${stamp}.csv`,
    Buffer.from("رقم الوحدة,السعر\nع-١٠١,٧٥٠٠٠٠٠\n", "utf8"),
    "text/csv",
  );
  assert.equal(csv.response.status, 201);
  assert.equal(csv.data.analysis.rows[0]["رقم الوحدة"], "ع-١٠١");

  let current = xlsx.data;
  const resolutions = [
    ["projectName", `Import Smoke Project ${stamp}`],
    ["developerName", `Import Smoke Developer ${stamp}`],
    ["locationId", `unconfirmed-smoke-location-${stamp}`],
    ["column:Unknown Sales Label", "IGNORE"],
  ];
  for (const [field, value] of resolutions) {
    const resolved = await request(`/admin/imports/${xlsx.data.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ field, value }),
    });
    assert.ok(resolved.response.ok, `${field} resolution failed`);
    current = resolved.data;
  }
  assert.equal(current.preview.canConfirm, true);
  assert.equal(current.status, "READY");

  const emptyBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(emptyBook, XLSX.utils.aoa_to_sheet([]), "Empty");
  const empty = await upload(
    `import-smoke-empty-${stamp}.xlsx`,
    XLSX.write(emptyBook, { type: "buffer", bookType: "xlsx" }),
  );
  assert.equal(empty.response.status, 422);
  assert.equal(empty.data.code, "IMPORT_NO_USABLE_SHEETS");

  const invalid = await upload(
    `import-smoke-invalid-${stamp}.xlsx`,
    Buffer.from("not an xlsx", "utf8"),
  );
  assert.equal(invalid.response.status, 415);
  assert.equal(invalid.data.code, "IMPORT_SIGNATURE_MISMATCH");

  const oversized = await upload(
    `import-smoke-large-${stamp}.csv`,
    Buffer.alloc(20 * 1024 * 1024 + 1, 0x61),
    "text/csv",
  );
  assert.equal(oversized.response.status, 413);
  assert.equal(oversized.data.code, "IMPORT_FILE_TOO_LARGE");

  console.log(JSON.stringify({
    cors: "PASS",
    unauthenticated401: "PASS",
    adminCookie: "PASS",
    xlsx: "PASS",
    xls: "PASS",
    utf8CsvArabic: "PASS",
    aiIndependentUpload: "PASS",
    missingFields: "PASS",
    r2Source: "PASS",
    preview: "PASS",
    emptyWorkbook422: "PASS",
    invalidSignature415: "PASS",
    oversized413: "PASS",
  }));
}

async function cleanup() {
  if (importIds.length)
    await prisma.dataImport.deleteMany({ where: { id: { in: importIds } } });
  if (objectKeys.length)
    await s3.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET,
      Delete: { Objects: [...new Set(objectKeys)].map((Key) => ({ Key })) },
    }));
  await prisma.$disconnect();
}

try { await main(); } finally { await cleanup(); }
