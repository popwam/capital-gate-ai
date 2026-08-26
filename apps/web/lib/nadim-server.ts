import { createHash, randomUUID } from "node:crypto";

export type NadimWebTurnInput = {
  legacyConversationId: string;
  conversationId?: string;
  deviceToken: string;
  message: string;
  displayMessage?: string;
  locale?: string;
  eventId: string;
};

export type NadimWebTurnResult = {
  conversationId: string;
  reply: string;
  message: {
    id: string;
    role: "ASSISTANT";
    content: string;
    toolPayload?: Record<string, unknown> | null;
    createdAt: string;
  };
  state?: { languageStyle?: { preferredResponseStyle?: string } };
};

type ServerEnvironment = Record<string, string | undefined>;
type RateWindow = { startedAt: number; count: number };
const rateWindows = new Map<string, RateWindow>();

export class NadimWebAdapterError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(status: number, message: string, code?: string, requestId?: string) {
    super(message);
    this.name = "NadimWebAdapterError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

const requiredText = (value: unknown, name: string, maxLength: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new NadimWebAdapterError(400, `${name} is invalid`, "INVALID_WEB_TURN");
  }
  return value.trim();
};

export function parseNadimWebTurnInput(value: unknown): NadimWebTurnInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const conversationId = typeof input.conversationId === "string" && input.conversationId.trim()
    ? requiredText(input.conversationId, "conversationId", 200)
    : undefined;
  const locale = typeof input.locale === "string" && input.locale.trim()
    ? requiredText(input.locale, "locale", 35)
    : undefined;
  return {
    legacyConversationId: requiredText(input.legacyConversationId, "legacyConversationId", 200),
    conversationId,
    deviceToken: requiredText(input.deviceToken, "deviceToken", 500),
    message: requiredText(input.message, "message", 8_000),
    displayMessage: typeof input.displayMessage === "string" && input.displayMessage.trim()
      ? requiredText(input.displayMessage, "displayMessage", 8_000)
      : undefined,
    locale,
    eventId: requiredText(input.eventId, "eventId", 200),
  };
}

export function checkNadimWebRateLimit(deviceToken: string, now = Date.now(), limit = 20, windowMs = 60_000) {
  const key = createHash("sha256").update(deviceToken).digest("hex");
  const current = rateWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    rateWindows.set(key, { startedAt: now, count: 1 });
  } else {
    current.count += 1;
    if (current.count > limit) throw new NadimWebAdapterError(429, "Too many messages. Please try again shortly.", "WEB_CHAT_RATE_LIMITED");
  }
  if (rateWindows.size > 5_000) {
    for (const [entryKey, value] of rateWindows) if (now - value.startedAt >= windowMs) rateWindows.delete(entryKey);
  }
}

function safeUpstreamError(status: number, body: unknown, requestId?: string) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const rawMessage = Array.isArray(record.message) ? record.message[0] : record.message;
  const message = typeof rawMessage === "string" ? rawMessage : "Nadim is temporarily unavailable";
  const code = typeof record.code === "string" ? record.code : undefined;
  return new NadimWebAdapterError(status, message, code, requestId);
}

export async function forwardNadimWebTurn(
  input: NadimWebTurnInput,
  fetcher: typeof fetch = fetch,
  environment: ServerEnvironment = process.env,
): Promise<NadimWebTurnResult> {
  const secret = environment.NADIM_GATEWAY_SECRET?.trim();
  if (!secret) throw new NadimWebAdapterError(503, "Nadim web gateway is not configured", "NADIM_WEB_NOT_CONFIGURED");
  const apiUrl = (environment.NADIM_API_URL || environment.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  const requestId = randomUUID();
  const externalUserId = `web:${createHash("sha256").update(`${input.deviceToken}:${input.legacyConversationId}`).digest("hex")}`;
  const headers = {
    "content-type": "application/json",
    "x-idempotency-key": input.eventId,
    "x-nadim-gateway-secret": secret,
    "x-request-id": requestId,
  };
  const upstream = await fetcher(`${apiUrl}/v2/nadim/turn`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      channel: "WEB",
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      externalUserId,
      message: input.message,
      ...(input.locale ? { locale: input.locale } : {}),
      metadata: { eventId: input.eventId, webConversationId: input.legacyConversationId },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });
  const result = await upstream.json().catch(() => null) as Record<string, any> | null;
  if (!upstream.ok || !result) throw safeUpstreamError(upstream.status, result, upstream.headers.get("x-request-id") ?? requestId);
  if (typeof result.conversationId !== "string" || typeof result.reply !== "string") {
    throw new NadimWebAdapterError(502, "Nadim returned an invalid response", "INVALID_NADIM_RESPONSE", requestId);
  }

  const persisted = await fetcher(`${apiUrl}/v1/internal/web-chat/persist`, {
    method: "POST",
    headers: { ...headers, "x-device-token": input.deviceToken },
    body: JSON.stringify({
      legacyConversationId: input.legacyConversationId,
      nadimConversationId: result.conversationId,
      eventId: input.eventId,
      userMessage: input.displayMessage ?? input.message,
      assistantReply: result.reply,
      resultMetadata: {
        intent: result.intent,
        languageStyle: result.state?.languageStyle,
        brainVersion: result.version,
        replayed: result.replayed,
      },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const message = await persisted.json().catch(() => null);
  if (!persisted.ok || !message) throw safeUpstreamError(persisted.status, message, persisted.headers.get("x-request-id") ?? requestId);

  return { conversationId: result.conversationId, reply: result.reply, message, state: result.state };
}
