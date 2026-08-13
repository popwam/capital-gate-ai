import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { DeleteObjectsCommand, S3Client } from "@aws-sdk/client-s3";
import * as XLSX from "xlsx";

const base = (process.env.SMOKE_API_URL || "http://localhost:4000").replace(/\/$/, "") + "/v1";
const required = ["ADMIN_BOOTSTRAP_EMAIL", "ADMIN_BOOTSTRAP_PASSWORD", "DATABASE_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"];
for (const key of required) assert.ok(process.env[key], `${key} is required`);

let cookie = "";
const device = `${randomUUID()}-${randomUUID()}`;
const created = { locationId: "", developerId: "", projectId: "", importIds: [], conversationIds: [], objectKeys: [] };
const prisma = new PrismaClient();
const s3 = new S3Client({ region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });

async function request(path, { method = "GET", body, admin = false, deviceToken = false } = {}) {
  const headers = {};
  if (admin) headers.cookie = cookie;
  if (deviceToken) headers["x-device-token"] = device;
  if (body && !(body instanceof FormData)) headers["content-type"] = "application/json";
  const response = await fetch(`${base}${path}`, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${text}`);
  return { response, data };
}

function workbook(name) {
  const rows = [{ "Unit Number": name, "Unit Type": "Apartment", Bedrooms: 2, BUA: 140, Price: 7250000, Currency: "EGP", DP: 725000, Years: 7, Status: "AVAILABLE" }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), "Inventory");
  return book;
}

function trackUrl(url) {
  const prefix = `${process.env.R2_PUBLIC_BASE_URL.replace(/\/$/, "")}/`;
  if (url?.startsWith(prefix)) created.objectKeys.push(decodeURIComponent(url.slice(prefix.length)));
}

async function uploadImport(extension, externalId, metadata) {
  const type = extension === "xlsx" ? "xlsx" : "biff8";
  const buffer = XLSX.write(workbook(externalId), { type: "buffer", bookType: type });
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: "application/octet-stream" }), `inventory.${extension}`);
  for (const [key, value] of Object.entries(metadata)) form.append(key, value);
  const analyzed = (await request("/admin/imports/upload", { method: "POST", body: form, admin: true })).data;
  created.importIds.push(analyzed.id); trackUrl(analyzed.fileUrl);
  assert.equal((await fetch(analyzed.fileUrl)).status, 200);
  const preview = (await request(`/admin/imports/${analyzed.id}/preview`, { method: "POST", admin: true })).data.preview;
  assert.equal(preview.canConfirm, true);
  return (await request(`/admin/imports/${analyzed.id}/confirm`, { method: "POST", admin: true })).data.result;
}

async function main() {
  const login = await fetch(`${base}/admin/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.ADMIN_BOOTSTRAP_EMAIL, password: process.env.ADMIN_BOOTSTRAP_PASSWORD }) });
  assert.ok(login.ok, `Admin login failed: ${login.status}`);
  const setCookie = login.headers.get("set-cookie") || "";
  const token = setCookie.match(/maqar_admin_session=([^;]+)/)?.[1];
  assert.ok(token); cookie = `maqar_admin_session=${token}`;
  for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=Lax/i, /Domain=\.cg\.popwam\.com/i, /Path=\//i, /Max-Age=/i]) assert.match(setCookie, attribute);
  await request("/admin/auth/me", { admin: true });

  const stamp = Date.now();
  const location = (await request("/admin/locations", { method: "POST", admin: true, body: { type: "AREA", name: `Railway Verification Area ${stamp}`, slug: `railway-verification-${stamp}`, latitude: 30.0074, longitude: 31.4913 } })).data;
  created.locationId = location.id;
  await request(`/admin/locations/${location.id}/aliases`, { method: "POST", admin: true, body: { value: `Railway Area ${stamp}`, language: "en" } });

  const metadata = { projectName: `Railway Verification Residence ${stamp}`, developerName: `Railway Verification Developer ${stamp}`, locationId: location.id };
  const xlsx = await uploadImport("xlsx", `RAIL-${stamp}-A`, metadata);
  created.developerId = xlsx.developerId; created.projectId = xlsx.projectId;
  const xls = await uploadImport("xls", `RAIL-${stamp}-B`, metadata);
  assert.equal(xls.projectId, created.projectId);
  const units = (await request(`/admin/catalog/units?projectId=${created.projectId}`, { admin: true })).data;
  assert.equal(units.length, 2);

  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const mediaForm = new FormData(); mediaForm.append("type", "IMAGE"); mediaForm.append("projectId", created.projectId); mediaForm.append("file", new Blob([png], { type: "image/png" }), "project.png");
  const media = (await request("/admin/catalog/media", { method: "POST", body: mediaForm, admin: true })).data; trackUrl(media.url);
  assert.equal((await fetch(media.url)).status, 200);

  const documentForm = new FormData(); documentForm.append("type", "BROCHURE"); documentForm.append("projectId", created.projectId); documentForm.append("file", new Blob(["%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF"], { type: "application/pdf" }), "brochure.pdf");
  const document = (await request("/admin/catalog/documents", { method: "POST", body: documentForm, admin: true })).data; trackUrl(document.url);
  assert.equal((await fetch(document.url)).status, 200);

  if (process.env.SMOKE_SKIP_AI === "1") {
    console.log(JSON.stringify({ adminAuth: "PASS", xlsxImport: "PASS", xlsImport: "PASS", importTransaction: "PASS", databaseInventory: "PASS", r2Image: "PASS", r2Pdf: "PASS", cleanup: "PENDING" }));
    return;
  }

  const knowledgeForm = new FormData(); knowledgeForm.append("file", new Blob([`${metadata.projectName} is a residential project with landscaped gardens, a clubhouse, and 24-hour security.`], { type: "text/plain" }), "knowledge.txt");
  const knowledge = (await request(`/admin/projects/${created.projectId}/knowledge/upload`, { method: "POST", body: knowledgeForm, admin: true })).data; trackUrl(knowledge.document.url);
  await request(`/admin/projects/${created.projectId}/knowledge/${knowledge.knowledge.id}/approve`, { method: "POST", admin: true });
  assert.equal((await fetch(knowledge.document.url)).status, 200);

  const first = (await request("/conversations", { method: "POST", body: { title: "Production live smoke" }, deviceToken: true })).data; created.conversationIds.push(first.id);
  const second = (await request("/conversations", { method: "POST", body: { title: "Independent conversation" }, deviceToken: true })).data; created.conversationIds.push(second.id);
  const stream = await fetch(`${base}/conversations/${first.id}/messages/stream`, { method: "POST", headers: { "content-type": "application/json", "x-device-token": device }, body: JSON.stringify({ content: `عايز Apartment غرفتين في Railway Area ${stamp} بحد أقصى 8 مليون EGP` }) });
  const sse = await stream.text(); assert.ok(stream.ok); assert.match(sse, /event: token/); assert.match(sse, /event: complete/); assert.match(sse, new RegExp(`RAIL-${stamp}-[AB]`));
  const english = (await request(`/conversations/${first.id}/messages`, { method: "POST", deviceToken: true, body: { content: "I am comparing the verified options for investment." } })).data;
  assert.ok(english.state.language);
  const mixed = (await request(`/conversations/${first.id}/messages`, { method: "POST", deviceToken: true, body: { content: "ممكن payment plan details لل options دي؟" } })).data;
  assert.ok(mixed.state.language);
  const images = (await request(`/conversations/${first.id}/messages`, { method: "POST", deviceToken: true, body: { content: "وريني صور" } })).data; assert.equal(images.type, "media"); assert.ok(images.media.some(item => item.id === media.id));
  const brochure = (await request(`/conversations/${first.id}/messages`, { method: "POST", deviceToken: true, body: { content: "ممكن البروشور؟" } })).data; assert.equal(brochure.type, "documents"); assert.ok(brochure.documents.some(item => item.id === document.id));
  const lead = (await request(`/conversations/${first.id}/messages`, { method: "POST", deviceToken: true, body: { content: "أنا جاهز أشتري now. اسمي Railway Tester ورقمي +201000000000" } })).data; assert.equal(lead.type, "lead_created");
  const storedLead = await prisma.lead.findUnique({ where: { id: lead.leadId } }); assert.equal(storedLead.conversationId, first.id); assert.ok(storedLead.payload?.conversationSummary); assert.ok(storedLead.payload?.interestedUnits?.length); assert.ok(storedLead.payload?.interestedProjects?.includes(created.projectId));

  console.log(JSON.stringify({ adminAuth: "PASS", xlsxImport: "PASS", xlsImport: "PASS", importTransaction: "PASS", geminiStructured: "PASS", geminiStreaming: "PASS", databaseSearch: "PASS", multipleConversations: "PASS", media: "PASS", brochure: "PASS", knowledge: "PASS", lead: "PASS", r2Retrieval: "PASS" }));
}

async function cleanup() {
  for (const id of created.conversationIds) await prisma.conversation.deleteMany({ where: { id } });
  if (created.projectId) {
    await prisma.projectKnowledgeItem.deleteMany({ where: { projectId: created.projectId } });
    await prisma.projectKnowledge.deleteMany({ where: { projectId: created.projectId } });
    await prisma.document.deleteMany({ where: { projectId: created.projectId } });
    await prisma.media.deleteMany({ where: { projectId: created.projectId } });
    await prisma.unit.deleteMany({ where: { projectId: created.projectId } });
  }
  if (created.importIds.length) await prisma.dataImport.deleteMany({ where: { id: { in: created.importIds } } });
  if (created.projectId) await prisma.project.deleteMany({ where: { id: created.projectId } });
  if (created.developerId) await prisma.developer.deleteMany({ where: { id: created.developerId } });
  if (created.locationId) await prisma.location.deleteMany({ where: { id: created.locationId } });
  if (created.objectKeys.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.R2_BUCKET, Delete: { Objects: [...new Set(created.objectKeys)].map(Key => ({ Key })) } }));
}

try { await main(); } finally { await cleanup(); await prisma.$disconnect(); }
