export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type ApiConversation = { id: string; title: string | null; detectedLanguage?: string | null; createdAt: string; updatedAt: string; _count?: { messages: number } };
export type ApiMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; toolPayload?: Record<string, unknown> | null; createdAt: string };

export function getDeviceToken() {
  let token = localStorage.getItem("maqar-device-id");
  if (!token) { token = `${crypto.randomUUID()}-${crypto.randomUUID()}`; localStorage.setItem("maqar-device-id", token); }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}, device = true): Promise<T> {
  const headers = new Headers(init.headers); if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (device) headers.set("x-device-token", getDeviceToken());
  const response = await fetch(`${API_URL}/v1${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(Array.isArray(body.message) ? body.message[0] : body.message || `Request failed (${response.status})`); }
  return response.json();
}

export const conversationsApi = {
  list: () => request<ApiConversation[]>("/conversations"),
  create: (title: string) => request<ApiConversation>("/conversations", { method: "POST", body: JSON.stringify({ title }) }),
  messages: (id: string) => request<ApiMessage[]>(`/conversations/${id}/messages`),
  rename: (id: string, title: string) => request<ApiConversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  remove: (id: string) => request<{ deleted: true }>(`/conversations/${id}`, { method: "DELETE" }),
  async stream(id: string, content: string, handlers: { token: (text: string) => void; complete: (data: any) => void }) {
    const response = await fetch(`${API_URL}/v1/conversations/${id}/messages/stream`, { method: "POST", headers: { "content-type": "application/json", "x-device-token": getDeviceToken() }, credentials: "include", body: JSON.stringify({ content }) });
    if (!response.ok || !response.body) throw new Error((await response.json().catch(() => null))?.message || "Unable to start response stream");
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
      for (const event of events) { const name = event.split("\n").find(x => x.startsWith("event:"))?.slice(6).trim(); const raw = event.split("\n").find(x => x.startsWith("data:"))?.slice(5).trim(); if (!raw) continue; const data = JSON.parse(raw); if (name === "token") handlers.token(data.text); else if (name === "complete") handlers.complete(data); else if (name === "error") throw new Error(data.message || "Streaming failed"); }
    }
  }
};

export const adminApi = {
  login: (email: string, password: string) => request<{ admin: unknown }>("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  logout: () => request("/admin/auth/logout", { method: "POST", body: "{}" }, false),
  me: () => request("/admin/auth/me", {}, false),
  get: <T>(path: string) => request<T>(`/admin${path}`, {}, false),
  post: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }, false),
  patch: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "PATCH", body: JSON.stringify(body ?? {}) }, false),
  upload: async <T>(path: string, form: FormData) => request<T>(`/admin${path}`, { method: "POST", body: form }, false)
};
