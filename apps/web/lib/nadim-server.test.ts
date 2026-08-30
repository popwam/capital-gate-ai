import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkNadimWebRateLimit, forwardNadimWebTurn, NadimWebAdapterError, parseNadimWebTurnInput } from "./nadim-server.ts";

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
    assert.ok(result.message);
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
  assert.match(client, /\/api\/backend\/v1/u);
  assert.doesNotMatch(client, /NADIM_GATEWAY_SECRET|x-nadim-gateway-secret/u);
  assert.doesNotMatch(client, /NEXT_PUBLIC_API_URL|localhost:4000|api\.cg|railway\.app/iu);
  assert.doesNotMatch(client, /messages\/stream/u);
});

test("a sparse Nadim V2 201 response is accepted and trailing API slashes are normalized", async () => {
  const calls: string[] = [];
  const result = await forwardNadimWebTurn({
    legacyConversationId: "web-201",
    deviceToken: "device-token-with-sufficient-length",
    message: "hello",
    eventId: "event-201",
  }, async (url) => {
    calls.push(String(url));
    if (String(url).endsWith("/v2/nadim/turn")) {
      return Response.json({ conversationId: "nadim-201", reply: "reply" }, { status: 201 });
    }
    return Response.json({ id: "message-201", role: "ASSISTANT", content: "reply", createdAt: new Date(0).toISOString() });
  }, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api///" });
  assert.deepEqual(calls, [
    "http://private-api/v2/nadim/turn",
    "http://private-api/v1/internal/web-chat/persist",
  ]);
  assert.equal(result.reply, "reply");
});

for (const testCase of [
  { status: 401, body: { code: "UNAUTHORIZED", message: "Unauthorized" } },
  { status: 409, body: { code: "IDEMPOTENCY_CONFLICT", message: "Conflict" } },
  { status: 500, body: { code: "INTERNAL_ERROR", message: "Unavailable" } },
]) {
  test(`Nadim V2 ${testCase.status} errors are mapped without exposing the gateway secret`, async () => {
    await assert.rejects(
      forwardNadimWebTurn({
        legacyConversationId: "web-error",
        deviceToken: "device-token-with-sufficient-length",
        message: "hello",
        eventId: "event-error",
      }, async () => Response.json(testCase.body, { status: testCase.status }), {
        NADIM_GATEWAY_SECRET: "do-not-leak-this-secret",
        NADIM_API_URL: "http://private-api",
      }),
      (error: unknown) => {
        assert.ok(error instanceof NadimWebAdapterError);
        assert.equal(error.status, testCase.status);
        assert.equal(error.code, testCase.body.code);
        assert.doesNotMatch(error.message, /do-not-leak-this-secret|private-api/u);
        return true;
      },
    );
  });
}

test("raw network failures and malformed JSON become deterministic safe 502 errors", async () => {
  const input = {
    legacyConversationId: "web-invalid",
    deviceToken: "device-token-with-sufficient-length",
    message: "hello",
    eventId: "event-invalid",
  };
  await assert.rejects(
    forwardNadimWebTurn(input, async () => { throw Object.assign(new Error("connect ECONNREFUSED secret"), { code: "ECONNREFUSED" }); }, {
      NADIM_GATEWAY_SECRET: "server-secret",
      NADIM_API_URL: "http://private-api",
    }),
    (error: unknown) => error instanceof NadimWebAdapterError
      && error.status === 502
      && error.code === "NADIM_UPSTREAM_NETWORK_ERROR"
      && error.stage === "upstream_fetch"
      && !error.message.includes("secret"),
  );
  await assert.rejects(
    forwardNadimWebTurn(input, async () => new Response("not json", { status: 200 }), {
      NADIM_GATEWAY_SECRET: "server-secret",
      NADIM_API_URL: "http://private-api",
    }),
    (error: unknown) => error instanceof NadimWebAdapterError
      && error.status === 502
      && error.code === "INVALID_NADIM_RESPONSE"
      && error.stage === "upstream_response_parse",
  );
});

test("history persistence failure does not discard an already valid Nadim reply", async () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    const result = await forwardNadimWebTurn({
      legacyConversationId: "web-persist-failure",
      deviceToken: "device-token-with-sufficient-length",
      message: "hello",
      eventId: "stable-event-id",
    }, async (url) => {
      if (String(url).endsWith("/v2/nadim/turn")) return Response.json({ conversationId: "nadim-kept", reply: "valid reply" });
      throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    }, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api" });
    assert.equal(result.conversationId, "nadim-kept");
    assert.equal(result.reply, "valid reply");
    assert.ok(result.message);
    assert.equal(result.message.content, "valid reply");
    assert.equal(result.message.toolPayload?.historyPersisted, false);
  } finally {
    console.error = original;
  }
});

test("web control commands stay same-origin and HUMAN ownership suppresses assistant persistence", async () => {
  const calls: Array<{ url: string; body: any }> = [];
  const result = await forwardNadimWebTurn({
    legacyConversationId: "web-handoff",
    conversationId: "nadim-handoff",
    deviceToken: "device-token-with-sufficient-length",
    message: "لسه مستني الموظف",
    eventId: "human-inbound-1",
    controlCommand: undefined,
  }, async (url, init = {}) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url: String(url), body });
    if (String(url).endsWith("/v2/nadim/turn")) {
      return Response.json({ conversationId: "nadim-handoff", reply: "", suppressReply: true, mode: "HUMAN" });
    }
    return Response.json({ id: "user-only", role: "USER", content: body.userMessage, createdAt: new Date(0).toISOString() });
  }, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api" });
  assert.equal(result.mode, "HUMAN");
  assert.equal(result.suppressReply, true);
  assert.equal(result.message, null);
  assert.equal(calls[1].body.suppressReply, true);
  assert.equal(calls[1].body.assistantReply, undefined);
});

test("a confirmed backend deletion is not re-persisted by the web adapter", async () => {
  const calls: string[] = [];
  const result = await forwardNadimWebTurn({
    legacyConversationId: "web-delete",
    conversationId: "nadim-delete",
    deviceToken: "device-token-with-sufficient-length",
    message: "أيوه احذفها",
    eventId: "delete-confirmation-1",
  }, async (url) => {
    calls.push(String(url));
    return Response.json({ conversationId: "nadim-delete", reply: "تم حذف المحادثة وذاكرتها.", deleted: true, mode: "AI" });
  }, { NADIM_GATEWAY_SECRET: "server-secret", NADIM_API_URL: "http://private-api" });
  assert.deepEqual(calls, ["http://private-api/v2/nadim/turn"]);
  assert.equal(result.deleted, true);
  assert.equal(result.message, null);
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

test("Web HUMAN mode keeps the customer composer enabled and refreshes human replies", () => {
  const client = readFileSync(new URL("../components/chat-app.tsx", import.meta.url), "utf8");
  assert.match(client, /mode !== "HUMAN"/u);
  assert.match(client, /window\.setInterval/u);
  assert.match(client, /active\?\.mode === "HUMAN"[\s\S]{0,300}HumanHandoffComposer/u);
  assert.match(client, /<Composer input=\{input\}/u);
  assert.doesNotMatch(client, /mode === "HUMAN" \? <HumanHandoffComposer[^:]+: <Composer/u);
});
