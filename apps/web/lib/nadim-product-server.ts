import { NadimWebAdapterError } from "./nadim-server";

function apiBaseUrl() {
  const raw = process.env.NADIM_API_URL?.trim() || process.env.INTERNAL_API_URL?.trim() || (process.env.NODE_ENV === "production" ? "" : "http://localhost:8080");
  if (!raw) throw new NadimWebAdapterError(503, "Nadim product actions are not configured", "NADIM_WEB_NOT_CONFIGURED");
  return raw.replace(/\/+$/u, "");
}

export async function forwardNadimProduct(path: string, body: unknown, deviceToken: string) {
  const secret = process.env.NADIM_GATEWAY_SECRET?.trim();
  if (!secret) throw new NadimWebAdapterError(503, "Nadim product actions are not configured", "NADIM_WEB_NOT_CONFIGURED");
  const response = await fetch(`${apiBaseUrl()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nadim-gateway-secret": secret, "x-device-token": deviceToken },
    body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new NadimWebAdapterError(response.status, typeof result.message === "string" ? result.message : "The conversation action failed", typeof result.code === "string" ? result.code : undefined);
  return result;
}
