import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { forwardInternalApiRequest, internalApiBaseUrl, isAllowedInternalApiRequest } from "./internal-api-server.ts";

test("the internal API proxy allows history/admin operations but blocks legacy customer reasoning", () => {
  assert.equal(isAllowedInternalApiRequest("v1/conversations", "GET"), true);
  assert.equal(isAllowedInternalApiRequest("v1/conversations/id/messages", "GET"), true);
  assert.equal(isAllowedInternalApiRequest("v1/conversations/id/messages", "POST"), false);
  assert.equal(isAllowedInternalApiRequest("v1/conversations/id/messages/stream", "POST"), false);
  assert.equal(isAllowedInternalApiRequest("v1/admin/auth/me", "GET"), true);
  assert.equal(isAllowedInternalApiRequest("v2/nadim/turn", "POST"), false);
});

test("internal API URLs normalize trailing slashes and never use public browser environment", () => {
  assert.equal(internalApiBaseUrl({ INTERNAL_API_URL: "http://api.internal///" }), "http://api.internal");
  assert.throws(() => internalApiBaseUrl({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://deleted.example" }));
});

test("the proxy forwards device identity and rewrites admin cookies for the web host", async () => {
  let upstreamUrl = "";
  let upstreamHeaders = new Headers();
  const response = await forwardInternalApiRequest(new Request("https://web.example/api/backend/v1/conversations", {
    headers: { "x-device-token": "device-token", cookie: "session=value" },
  }), ["v1", "conversations"], async (url, init) => {
    upstreamUrl = String(url);
    upstreamHeaders = new Headers(init?.headers);
    return new Response("[]", { headers: { "content-type": "application/json", "set-cookie": "session=new; Domain=api.internal; Path=/; HttpOnly" } });
  }, { INTERNAL_API_URL: "http://api.internal/" });
  assert.equal(upstreamUrl, "http://api.internal/v1/conversations");
  assert.equal(upstreamHeaders.get("x-device-token"), "device-token");
  assert.equal(upstreamHeaders.get("cookie"), "session=value");
  assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /Domain=/iu);
});

test("browser API code contains no direct backend origin", () => {
  const client = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.doesNotMatch(client, /NEXT_PUBLIC_API_URL|https?:\/\/localhost:4000|railway\.app/iu);
  assert.match(client, /\/api\/backend\/v1/u);
});
