const API_ROUTE = "/api/backend/v1";

export type ApiConversation = { id: string; title: string | null; detectedLanguage?: string | null; nadimConversationId?: string | null; mode?: "AI" | "HUMAN" | "PAUSED"; createdAt: string; updatedAt: string; closed?: boolean; _count?: { messages: number } };
export type ApiMessage = { id: string; role: "USER" | "ASSISTANT"; content: string; toolPayload?: Record<string, unknown> | null; createdAt: string };
export type NadimWebTurnResponse = { conversationId: string; reply: string; message: ApiMessage | null; state?: { languageStyle?: { preferredResponseStyle?: string } }; suppressReply: boolean; mode: "AI" | "HUMAN" | "PAUSED"; deleted?: boolean };

export type AdminMutationState = "saving" | "saved" | "error";
export type AdminMutationDetail = { id: string; state: AdminMutationState; method: string; path: string; message?: string; requestId?: string };

function emitAdminMutation(detail: AdminMutationDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<AdminMutationDetail>("cg-admin-mutation", { detail }));
}


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
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set("content-type", "application/json");
  if (device) headers.set("x-device-token", getDeviceToken());
  const method = String(init.method ?? "GET").toUpperCase();
  const isAdminMutation = path.startsWith("/admin") && !["GET", "HEAD", "OPTIONS"].includes(method);
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  // Send our request id to the API so the id shown in the browser is the same id
  // searchable in application logs. Railway also has its own edge request id; they are separate.
  if (path.startsWith("/admin")) headers.set("x-request-id", requestId);
  const mutationId = requestId;
  if (isAdminMutation) emitAdminMutation({ id: mutationId, state: "saving", method, path, requestId });
  try {
    const response = await fetch(`${API_ROUTE}${path}`, { ...init, headers, credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const baseMessage = Array.isArray(body.message) ? body.message[0] : body.message || `Request failed (${response.status})`;
      const missing = Array.isArray(body.missing) ? body.missing.filter((item: unknown) => typeof item === "string") : [];
      const message = missing.length ? `${baseMessage} — ${missing.join(" · ")}` : baseMessage;
      const requestId = body.requestId || response.headers.get("x-request-id") || undefined;
      if (isAdminMutation) emitAdminMutation({ id: mutationId, state: "error", method, path, message, requestId });
      throw new ApiRequestError(message, response.status, body.code, requestId);
    }
    const result = await response.json().catch(() => undefined) as T;
    if (isAdminMutation) emitAdminMutation({ id: mutationId, state: "saved", method, path, requestId: response.headers.get("x-request-id") || undefined });
    return result;
  } catch (error) {
    if (isAdminMutation && !(error instanceof ApiRequestError))
      emitAdminMutation({ id: mutationId, state: "error", method, path, message: error instanceof Error ? error.message : "Network error" });
    throw error;
  }
}

export function downloadFileName(disposition: string | null, fallback: string) {
  if (!disposition) return fallback;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { return fallback; }
  }
  return disposition.match(/filename="([^"]+)"/i)?.[1] || fallback;
}

async function downloadRequest(path: string, fallbackFileName: string) {
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  const response = await fetch(`${API_ROUTE}/admin${path}`, {
    credentials: "same-origin",
    headers: { "x-request-id": requestId },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message = Array.isArray(body.message) ? body.message[0] : body.message || `Request failed (${response.status})`;
    throw new ApiRequestError(message, response.status, body.code, body.requestId || response.headers.get("x-request-id") || undefined);
  }
  return {
    blob: await response.blob(),
    fileName: downloadFileName(response.headers.get("content-disposition"), fallbackFileName),
  };
}

export const conversationsApi = {
  list: () => request<ApiConversation[]>("/conversations"),
  create: (title: string) => request<ApiConversation>("/conversations", { method: "POST", body: JSON.stringify({ title }) }),
  messages: (id: string) => request<ApiMessage[]>(`/conversations/${id}/messages`),
  rename: (id: string, title: string) => request<ApiConversation>(`/conversations/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  remove: (id: string) => request<{ deleted: true }>(`/conversations/${id}`, { method: "DELETE" }),
};

export const nadimWebApi = {
  async turn(input: { legacyConversationId: string; conversationId?: string; message: string; displayMessage?: string; locale?: string; eventId: string; controlCommand?: "REQUEST_HUMAN_HANDOFF" | "RETURN_TO_AI" | "REQUEST_CONVERSATION_DELETION" | "CONFIRM_CONVERSATION_DELETION" }): Promise<NadimWebTurnResponse> {
    const response = await fetch("/api/nadim/turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ...input, deviceToken: getDeviceToken() }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(body.message || "Unable to reach Nadim", response.status, body.code, body.requestId);
    return body as NadimWebTurnResponse;
  },
  async conversationAction(legacyConversationId: string, action: "SHARE" | "WHATSAPP"): Promise<{ tokenId: string; url: string; expiresAt: string }> {
    const response = await fetch("/api/nadim/conversation-action", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ legacyConversationId, action, deviceToken: getDeviceToken() }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiRequestError(body.message || "Conversation action failed", response.status, body.code);
    return body;
  },
};

export const adminApi = {
  login: (email: string, password: string) => request<{ admin: unknown }>("/admin/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }, false),
  logout: () => request("/admin/auth/logout", { method: "POST", body: "{}" }, false),
  me: () => request("/admin/auth/me", {}, false),
  get: <T>(path: string) => request<T>(`/admin${path}`, {}, false),
  post: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "POST", body: JSON.stringify(body ?? {}) }, false),
  patch: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "PATCH", body: JSON.stringify(body ?? {}) }, false),
  delete: <T>(path: string, body?: unknown) => request<T>(`/admin${path}`, { method: "DELETE", body: JSON.stringify(body ?? {}) }, false),
  upload: async <T>(path: string, form: FormData) => request<T>(`/admin${path}`, { method: "POST", body: form }, false),
  download: (path: string, fallbackFileName: string) => downloadRequest(path, fallbackFileName),
};
