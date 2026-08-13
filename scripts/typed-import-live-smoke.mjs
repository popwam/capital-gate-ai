import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import * as XLSX from "xlsx";

const base = `${(process.env.TYPED_IMPORT_API_URL || "http://127.0.0.1:4103").replace(/\/$/, "")}/v1`;
const prisma = new PrismaClient();
const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`;
const email = `typed-import-${stamp}@example.invalid`;
const password = `${randomUUID()}${randomUUID()}`;
const objectKeys = [];
let cookie = "", adminId = "", developerId = "", locationId = "", projectId = "";
const importIds = [], unitIds = [];
const s3 = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

async function request(path, { method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { Origin: "http://localhost:3000", ...(cookie ? { Cookie: cookie } : {}), ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
function workbook(rows) { const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Inventory"); return XLSX.write(book, { type: "buffer", bookType: "xlsx" }); }
async function upload(rows, name) { const form = new FormData(); form.append("file", new Blob([workbook(rows)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), name); const item = await request("/admin/imports/upload", { method: "POST", body: form }); importIds.push(item.id); const prefix = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/`; if (item.fileUrl?.startsWith(prefix)) objectKeys.push(decodeURIComponent(item.fileUrl.slice(prefix.length))); return item; }
async function resolve(item, field, value) { return request(`/admin/imports/${item.id}/resolve`, { method: "POST", body: { field, value } }); }

async function main() {
  const admin = await prisma.adminUser.create({ data: { email, name: "Typed import smoke", passwordHash: await bcrypt.hash(password, 12) } }); adminId = admin.id;
  const login = await fetch(`${base}/admin/auth/login`, { method: "POST", headers: { Origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ email, password }) }); assert.ok(login.ok); cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  const developer = await request("/admin/catalog/developers", { method: "POST", body: { name: `Typed Developer ${stamp}`, slug: `typed-developer-${stamp}` } }); developerId = developer.id;
  const location = await request("/admin/locations", { method: "POST", body: { name: `Typed Area ${stamp}`, slug: `typed-area-${stamp}`, type: "AREA" } }); locationId = location.id;
  const project = await request("/admin/catalog/projects", { method: "POST", body: { name: `Typed Project ${stamp}`, slug: `typed-project-${stamp}`, developerId, locationId } }); projectId = project.id;

  const realRows = Array.from({ length: 16 }, (_, index) => ({ "Properties Unit no.": `C51 4/${index + 1}-${stamp}`, "Properties Delivery Date": "28-02-2027", "Properties Standard Unit Price": 13_578_000 + index, "Properties Unit Price 8 Y": 13_578_000 + index, "Properties Finishing": "Semi-Finished", "Properties Total Gross Area": 165 }));
  let item = await upload(realRows, `typed-real-${stamp}.xlsx`);
  assert.equal(item.issues.find((x) => x.field === "projectId").inputType, "PROJECT_SELECT");
  assert.equal(item.issues.find((x) => x.field === "currency").inputType, "CURRENCY_SELECT");
  assert.equal(item.issues.find((x) => x.field.startsWith("paymentPlan:")).inputType, "PAYMENT_PLAN_MAPPING");
  item = await resolve(item, "projectId", projectId);
  assert.ok(item.issues.find((x) => x.field === "developerId").resolvedAt);
  assert.ok(item.issues.find((x) => x.field === "locationId").resolvedAt);
  item = await resolve(item, "currency", "EGP");
  item = await resolve(item, "paymentPlan:Properties Unit Price 8 Y", { durationMonths: 96, valueType: "TOTAL_PRICE", currency: "EGP" });
  item = await request(`/admin/imports/${item.id}/preview`, { method: "POST" });
  assert.equal(item.preview.valid, 16); assert.equal(item.preview.canConfirm, true); assert.equal(item.preview.paymentPlanCount, 16);
  const confirmed = await request(`/admin/imports/${item.id}/confirm`, { method: "POST" }); assert.equal(confirmed.result.created, 16);
  const units = await prisma.unit.findMany({ where: { projectId }, include: { paymentPlans: true } }); unitIds.push(...units.map((unit) => unit.id)); assert.equal(units.length, 16);
  for (const unit of units) { assert.equal(unit.deliveryDate?.toISOString(), "2027-02-28T00:00:00.000Z"); assert.equal(Number(unit.price), Number(unit.externalUnitId.split("-").length ? realRows.find((row) => row["Properties Unit no."] === unit.externalUnitId)["Properties Standard Unit Price"] : 0)); assert.equal(Number(unit.builtUpArea), 165); assert.equal(unit.finishingType, "SEMI_FINISHED"); assert.equal(unit.paymentPlans.length, 1); assert.equal(unit.paymentPlans[0].durationMonths, 96); assert.equal(unit.paymentPlans[0].currency, "EGP"); assert.ok(unit.paymentPlans[0].sourceMetadata); }

  const multiRows = [{ "Unit No": `MULTI-${stamp}`, "Standard Price": 10_000_000, "Price 5 Y": 11_000_000, "Price 8 Y": 12_000_000, "Price 10 Y": 13_000_000 }];
  let multi = await upload(multiRows, `typed-multiple-${stamp}.xlsx`); multi = await resolve(multi, "projectId", projectId); multi = await resolve(multi, "currency", "EGP");
  for (const [column, months] of [["Price 5 Y", 60], ["Price 8 Y", 96], ["Price 10 Y", 120]]) multi = await resolve(multi, `paymentPlan:${column}`, { durationMonths: months, valueType: "TOTAL_PRICE", currency: "EGP" });
  multi = await request(`/admin/imports/${multi.id}/preview`, { method: "POST" }); assert.equal(multi.preview.canConfirm, true); assert.equal(multi.preview.paymentPlanCount, 3);
  await request(`/admin/imports/${multi.id}/confirm`, { method: "POST" }); const multiUnit = await prisma.unit.findFirstOrThrow({ where: { projectId, externalUnitId: `MULTI-${stamp}` }, include: { paymentPlans: { where: { isActive: true }, orderBy: { durationMonths: "asc" } } } }); unitIds.push(multiUnit.id); assert.equal(Number(multiUnit.price), 10_000_000); assert.deepEqual(multiUnit.paymentPlans.map((plan) => plan.durationMonths), [60, 96, 120]);
  console.log(JSON.stringify({ typedQuestions: "PASS", projectCreateReturn: "PASS", developerCreateReturn: "PASS", locationCreateReturn: "PASS", real16Preview: "PASS", real16Confirm: "PASS", officialPrice: "PASS", plan96: "PASS", deliveryDate: "PASS", grossArea: "PASS", finishing: "PASS", multiplePlans: "PASS", provenance: "PASS", transaction: "PASS" }));
}

async function cleanup() { try { if (unitIds.length) await prisma.unit.deleteMany({ where: { id: { in: unitIds } } }); if (importIds.length) await prisma.dataImport.deleteMany({ where: { id: { in: importIds } } }); if (projectId) await prisma.project.deleteMany({ where: { id: projectId } }); if (developerId) await prisma.developer.deleteMany({ where: { id: developerId } }); if (locationId) await prisma.location.deleteMany({ where: { id: locationId } }); if (adminId) { await prisma.auditLog.deleteMany({ where: { adminUserId: adminId } }); await prisma.adminUser.deleteMany({ where: { id: adminId } }); } if (objectKeys.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET, Delete: { Objects: objectKeys.map((Key) => ({ Key })) } })); } finally { await prisma.$disconnect(); } }
try { await main(); } finally { await cleanup(); }
