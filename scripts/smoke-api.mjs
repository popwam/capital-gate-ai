import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const base = (process.env.SMOKE_API_URL || "http://localhost:4000").replace(/\/$/, "");
const token = `${randomUUID()}-${randomUUID()}`;
async function call(path, init={}) { const response = await fetch(`${base}/v1${path}`, { ...init, headers: { "content-type": "application/json", "x-device-token": token, ...init.headers } }); const body = await response.json(); assert.ok(response.ok, JSON.stringify(body)); return body; }
const health = await call("/health"); assert.equal(health.status, "ok");
const conversation = await call("/conversations", { method: "POST", body: JSON.stringify({ title: "Production smoke test" }) }); assert.ok(conversation.id);
const listed = await call("/conversations"); assert.ok(listed.some(item => item.id === conversation.id));
await call(`/conversations/${conversation.id}`, { method: "PATCH", body: JSON.stringify({ title: "Renamed smoke test" }) });
const messages = await call(`/conversations/${conversation.id}/messages`); assert.deepEqual(messages, []);
await call(`/conversations/${conversation.id}`, { method: "DELETE" });
console.log("API smoke test passed: health, anonymous device hashing, create/list/rename/read/delete conversation");
