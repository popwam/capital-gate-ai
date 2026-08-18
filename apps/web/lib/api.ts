export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");

export type ApiConversation = { id: string; title: string | null; detectedLanguage?: string | null; createdAt: string; updatedAt: string; _count?: { messages: number } };
export type ApiMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; toolPayload?: Record<string, unknown> | null; createdAt: string };

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    status: number,
    code?: string,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function adminErrorMessage(error: unknown) {
  if (!(error instanceof ApiRequestError))
    return error instanceof Error ? error.message : "An unexpected error occurred.";
  const known: Record<string, string> = {
    UNAUTHENTICATED: "انتهت جلسة الإدارة. سجّل الدخول مرة أخرى. (Admin session expired)",
    FORBIDDEN: "Your Admin account is not authorized for this action.",
    IMPORT_FILE_TOO_LARGE: "الملف أكبر من الحد المسموح 20 MB.",
    IMPORT_UNSUPPORTED_FILE_TYPE: "نوع الملف غير مدعوم. Unsupported file type: استخدم XLSX أو XLS أو CSV بترميز UTF-8.",
    IMPORT_SIGNATURE_MISMATCH: "The file content does not match its extension.",
    IMPORT_PARSE_FAILED: "The file could not be read. Check that it is a valid Excel workbook or UTF-8 CSV.",
    IMPORT_NO_USABLE_SHEETS: "لا يحتوي الملف على صفحات أو صفوف صالحة. No usable sheets were found.",
    IMPORT_ROW_LIMIT_EXCEEDED: "The workbook exceeds the 10,000-row import limit.",
    IMPORT_VALIDATION_ISSUES: "Resolve all blocking import questions before confirmation.",
    IMPORT_STORAGE_AUTH_FAILED: "Storage authentication failed. Contact an administrator.",
    IMPORT_STORAGE_BUCKET_FAILED: "The inventory storage bucket is unavailable. Contact an administrator.",
    IMPORT_STORAGE_NETWORK_FAILED: "Storage is temporarily unavailable. Retry shortly.",
    IMPORT_STORAGE_FAILED: "Storage upload failed. Retry shortly.",
    IMPORT_DATABASE_FAILED: "The import could not be recorded. Retry or contact an administrator.",
    IMPORT_SCHEMA_OUT_OF_DATE: "قاعدة البيانات أقدم من الكود المنشور. شغّل db:migrate:deploy على خدمة API ثم أعد المحاولة.",
    IMPORT_RELATION_CONFLICT: "هناك تعارض في علاقة المطور أو المشروع أو المرحلة. راجع سياق الجدول ثم أنشئ معاينة جديدة.",
    IMPORT_DUPLICATE_UNIT: "يوجد كود وحدة مكرر يتعارض مع سجل موجود. راجع أكواد الوحدات ثم أعد المعاينة.",
    IMPORT_CONFIRM_FAILED: "فشل اعتماد الاستيراد داخل قاعدة البيانات. لم يتم حفظ بيانات جزئية؛ راجع Request ID في سجل API.",
  };
  const base = known[error.code ?? ""] || error.message || "An unexpected error occurred.";
  return `${base}${error.requestId ? ` Request ID: ${error.requestId}` : ""}`;
}

export function getDeviceToken() {
  let token = localStorage.getItem("cgai-device-id");
  if (!token) {
    token = localStorage.getItem("maqar-device-id") || `${crypto.randomUUID()}-${crypto.randomUUID()}`;
    localStorage.setItem("cgai-device-id", token);
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}, device = true): Promise<T> {
  const headers = new Headers(init.headers); if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (device) headers.set("x-device-token", getDeviceToken());
  const response = await fetch(`${API_URL}/v1${path}`, { ...init, headers, credentials: "include" });
  if (!response.ok) { const body = await response.json().catch(() => ({})); const message = Array.isArray(body.message) ? body.message[0] : body.message || `Request failed (${response.status})`; throw new ApiRequestError(message, response.status, body.code, body.requestId || response.headers.get("x-request-id") || undefined); }
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
    const reader = response.body.getReader(); const decoder = new TextDecoder("utf-8", { fatal: true }); let buffer = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) { buffer += decoder.decode(); break; } buffer += decoder.decode(value, { stream: true });
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
  delete: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "DELETE", body: JSON.stringify(body ?? {}) }, false),
  upload: async <T>(path: string, form: FormData) => request<T>(`/admin${path}`, { method: "POST", body: form }, false)
};
