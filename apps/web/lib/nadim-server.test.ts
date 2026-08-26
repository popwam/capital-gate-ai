import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkNadimWebRateLimit, forwardNadimWebTurn, parseNadimWebTurnInput } from "./nadim-server.ts";

const cases = [
  { message: "عايز شقة 3 غرف في التجمع تحت 8 مليون", style: "AR_EGYPTIAN", reply: "ملقتش تطابق دقيق بالمواصفات دي." },
  { message: "أبي شقة 3 غرف وودي تكون بالتقسيط", style: "AR_GULF", reply: "ما لقيت تطابق دقيق بالمواصفات هذي." },
  { message: "I need a 3-bedroom apartment in New Cairo under 8 million EGP", style: "EN_US", reply: "I didn't find an exact match for those requirements." },
  { message: "3ayz sho2a 3 rooms fel tagamo3 ta7t 8 million", style: "FRANCO_ARABIC", reply: "mala2etsh match mazboot lel talab da." },
  { message: "السلام عليكم", style: "AR_EGYPTIAN", reply: "وعليكم السلام، أنا نديم." },
  { message: "عايز شقة في التجمع", style: "AR_EGYPTIAN", reply: "خليني أدور لك في المخزون الموثق." },
] as const;

test("WEB customer turns reach Nadim V2 with secure idempotent headers and replies pass through exactly", async () => {
  for (const [index, item] of cases.entries()) {
    const calls: Array<{ url: string; init: RequestInit; body: any }> = [];
    const fetcher: typeof fetch = async (url, init = {}) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url: String(url), init, body });
      if (String(url).endsWith("/v2/nadim/turn")) {
        return Response.json({
          ok: true,
          version: "v2",
          replayed: false,
          conversationId: `nadim-${index}`,
          reply: item.reply,
          intent: { type: item.message === "السلام عليكم" ? "GREETING" : "PROPERTY_SEARCH", confidence: 1 },
          state: { languageStyle: { preferredResponseStyle: item.style } },
        });
      }
      return Response.json({ id: `assistant-${index}`, role: "ASSISTANT", content: item.reply, createdAt: new Date(0).toISOString() });
    };

    const result = await forwardNadimWebTurn({
      legacyConversationId: `web-${index}`,
      deviceToken: "device-token-with-sufficient-length",
      message: item.message,
      locale: "ar",
      eventId: `event-${index}`,
    }, fetcher, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api" });

    assert.equal(calls[0].url, "http://private-api/v2/nadim/turn");
    assert.equal(calls[0].body.channel, "WEB");
    assert.equal(calls[0].body.message, item.message);
    assert.equal(calls[0].body.metadata.eventId, `event-${index}`);
    assert.equal(new Headers(calls[0].init.headers).get("x-idempotency-key"), `event-${index}`);
    assert.equal(new Headers(calls[0].init.headers).get("x-nadim-gateway-secret"), "server-secret");
    assert.equal(calls[1].url, "http://private-api/v1/internal/web-chat/persist");
    assert.equal(result.reply, item.reply);
    assert.equal(result.message.content, item.reply);
    assert.equal(result.state?.languageStyle?.preferredResponseStyle, item.style);
  }
});

test("the returned Nadim conversation id is sent on every following turn", async () => {
  let firstBody: any;
  const fetcher: typeof fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    if (String(url).endsWith("/v2/nadim/turn")) {
      firstBody = body;
      return Response.json({ version: "v2", conversationId: "nadim-existing", reply: "same conversation" });
    }
    return Response.json({ id: "assistant", role: "ASSISTANT", content: "same conversation", createdAt: new Date(0).toISOString() });
  };
  await forwardNadimWebTurn({
    legacyConversationId: "web-existing",
    conversationId: "nadim-existing",
    deviceToken: "device-token-with-sufficient-length",
    message: "كمل",
    eventId: "follow-up-event",
  }, fetcher, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api" });
  assert.equal(firstBody.conversationId, "nadim-existing");
});

test("browser code calls only the same-origin adapter and contains no gateway secret variable", () => {
  const client = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
  assert.match(client, /fetch\("\/api\/nadim\/turn"/u);
  assert.doesNotMatch(client, /NADIM_GATEWAY_SECRET|x-nadim-gateway-secret/u);
  assert.doesNotMatch(client, /messages\/stream/u);
});

test("invalid browser payloads are rejected before any upstream request", () => {
  assert.throws(() => parseNadimWebTurnInput({ message: "hello" }), /legacyConversationId is invalid/u);
});

test("the server adapter retains the customer-chat per-device rate limit", () => {
  const token = `rate-limit-${crypto.randomUUID()}`;
  for (let index = 0; index < 20; index += 1) checkNadimWebRateLimit(token, 1_000);
  assert.throws(() => checkNadimWebRateLimit(token, 1_000), (error: any) => error.status === 429 && error.code === "WEB_CHAT_RATE_LIMITED");
  assert.doesNotThrow(() => checkNadimWebRateLimit(token, 61_001));
});
