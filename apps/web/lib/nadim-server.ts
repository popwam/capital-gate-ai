import { createHash, randomUUID } from "node:crypto";

export type NadimAdapterStage =
  | "input_parse"
  | "rate_limit"
  | "upstream_fetch"
  | "upstream_response_parse"
  | "upstream_validation"
  | "conversation_persist"
  | "unknown";

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
type NadimUpstreamResult = {
  conversationId?: unknown;
  reply?: unknown;
  intent?: unknown;
  state?: { languageStyle?: { preferredResponseStyle?: string } };
  version?: unknown;
  replayed?: unknown;
};
const rateWindows = new Map<string, RateWindow>();

export class NadimWebAdapterError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly stage: NadimAdapterStage;

  constructor(
    status: number,
    message: string,
    code?: string,
    requestId?: string,
    stage: NadimAdapterStage = "unknown",
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "NadimWebAdapterError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.stage = stage;
  }
}

const requiredText = (value: unknown, name: string, maxLength: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
    throw new NadimWebAdapterError(400, `${name} is invalid`, "INVALID_WEB_TURN", undefined, "input_parse");
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
    if (current.count > limit) {
      throw new NadimWebAdapterError(429, "Too many messages. Please try again shortly.", "WEB_CHAT_RATE_LIMITED", undefined, "rate_limit");
    }
  }
  if (rateWindows.size > 5_000) {
    for (const [entryKey, value] of rateWindows) if (now - value.startedAt >= windowMs) rateWindows.delete(entryKey);
  }
}

function apiBaseUrl(environment: ServerEnvironment) {
  const configured = environment.NADIM_API_URL?.trim() || environment.INTERNAL_API_URL?.trim();
  const raw = configured || (environment.NODE_ENV === "production" ? "" : "http://localhost:4000");
  if (!raw) {
    throw new NadimWebAdapterError(503, "Nadim web gateway is not configured", "NADIM_WEB_NOT_CONFIGURED", undefined, "upstream_fetch");
  }
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported protocol");
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch (error) {
    throw new NadimWebAdapterError(503, "Nadim web gateway is not configured", "NADIM_WEB_NOT_CONFIGURED", undefined, "upstream_fetch", error);
  }
}

function safeUpstreamError(status: number, body: unknown, requestId: string, stage: NadimAdapterStage) {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const rawMessage = Array.isArray(record.message) ? record.message[0] : record.message;
  const message = status < 500 && typeof rawMessage === "string" ? rawMessage : "Nadim is temporarily unavailable";
  const code = typeof record.code === "string" ? record.code : undefined;
  return new NadimWebAdapterError(status, message, code, requestId, stage);
}

function synthesizedMessage(input: NadimWebTurnInput, reply: string) {
  return {
    id: `nadim-${createHash("sha256").update(input.eventId).digest("hex").slice(0, 24)}`,
    role: "ASSISTANT" as const,
    content: reply,
    toolPayload: { historyPersisted: false },
    createdAt: new Date().toISOString(),
  };
}

export function logNadimAdapterFailure(error: unknown, context: {
  stage?: NadimAdapterStage;
  requestId?: string;
  conversationId?: string;
  upstreamUrl?: string;
} = {}) {
  const adapterError = error instanceof NadimWebAdapterError ? error : undefined;
  const source = error instanceof Error ? error : undefined;
  const cause = source?.cause instanceof Error ? source.cause as Error & { code?: string } : undefined;
  const sourceCode = (source as (Error & { code?: string }) | undefined)?.code ?? cause?.code ?? adapterError?.code;
  let upstream: { hostname: string; pathname: string } | undefined;
  if (context.upstreamUrl) {
    try {
      const url = new URL(context.upstreamUrl);
      upstream = { hostname: url.hostname, pathname: url.pathname };
    } catch { /* diagnostic context is optional */ }
  }
  console.error("NadimWebAdapterFailure", JSON.stringify({
    stage: context.stage ?? adapterError?.stage ?? "unknown",
    requestId: context.requestId ?? adapterError?.requestId,
    conversationId: context.conversationId,
    upstream,
    upstreamStatus: adapterError?.status,
    errorName: source?.name,
    errorCode: sourceCode,
    errorMessage: adapterError?.message ?? (sourceCode ? `${source?.name ?? "Error"}: ${sourceCode}` : source?.name),
  }));
}

export async function forwardNadimWebTurn(
  input: NadimWebTurnInput,
  fetcher: typeof fetch = fetch,
  environment: ServerEnvironment = process.env,
): Promise<NadimWebTurnResult> {
  const secret = environment.NADIM_GATEWAY_SECRET?.trim();
  if (!secret) throw new NadimWebAdapterError(503, "Nadim web gateway is not configured", "NADIM_WEB_NOT_CONFIGURED", undefined, "upstream_fetch");
  const apiUrl = apiBaseUrl(environment);
  const requestId = randomUUID();
  const externalUserId = `web:${createHash("sha256").update(`${input.deviceToken}:${input.legacyConversationId}`).digest("hex")}`;
  const headers = {
    "content-type": "application/json",
    "x-idempotency-key": input.eventId,
    "x-nadim-gateway-secret": secret,
    "x-request-id": requestId,
  };
  const turnUrl = `${apiUrl}/v2/nadim/turn`;
  let upstream: Response;
  try {
    upstream = await fetcher(turnUrl, {
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
  } catch (error) {
    throw new NadimWebAdapterError(502, "Nadim is temporarily unavailable", "NADIM_UPSTREAM_NETWORK_ERROR", requestId, "upstream_fetch", error);
  }

  let result: NadimUpstreamResult | null;
  try {
    result = await upstream.json() as NadimUpstreamResult;
  } catch (error) {
    throw new NadimWebAdapterError(502, "Nadim returned an invalid response", "INVALID_NADIM_RESPONSE", upstream.headers.get("x-request-id") ?? requestId, "upstream_response_parse", error);
  }
  if (!upstream.ok) throw safeUpstreamError(upstream.status, result, upstream.headers.get("x-request-id") ?? requestId, "upstream_validation");
  if (!result || typeof result.conversationId !== "string" || typeof result.reply !== "string") {
    throw new NadimWebAdapterError(502, "Nadim returned an invalid response", "INVALID_NADIM_RESPONSE", requestId, "upstream_validation");
  }

  const persistUrl = `${apiUrl}/v1/internal/web-chat/persist`;
  try {
    const persisted = await fetcher(persistUrl, {
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
    const message = await persisted.json();
    if (!persisted.ok || !message) throw safeUpstreamError(persisted.status, message, persisted.headers.get("x-request-id") ?? requestId, "conversation_persist");
    return { conversationId: result.conversationId, reply: result.reply, message, state: result.state };
  } catch (error) {
    logNadimAdapterFailure(error, { stage: "conversation_persist", requestId, conversationId: result.conversationId, upstreamUrl: persistUrl });
    return {
      conversationId: result.conversationId,
      reply: result.reply,
      message: synthesizedMessage(input, result.reply),
      state: result.state,
    };
  }
}
