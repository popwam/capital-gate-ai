export type AdminAccessDecision = "ALLOW_ADMIN" | "PRIVATE_ENTRY" | "NOT_FOUND" | "LOCAL_LOGIN" | "PASS";

export function normalizeAdminAccessPath(value?: string) {
  return (value || "").trim().replace(/^\/+|\/+$/g, "");
}

export function validAdminAccessPath(value?: string) {
  const normalized = normalizeAdminAccessPath(value);
  const token = normalized.split("/").at(-1) || "";
  return /^[A-Za-z0-9_-]{32,}$/.test(token) ? normalized : "";
}

export function adminAccessDecision(input: { pathname: string; configuredPath?: string; production: boolean; authenticated: boolean }): AdminAccessDecision {
  const configured = validAdminAccessPath(input.configuredPath);
  const privatePath = configured ? `/${configured}` : "";
  if (privatePath && input.pathname === privatePath) return "PRIVATE_ENTRY";
  if (input.pathname === "/admin" || input.pathname.startsWith("/admin/")) {
    if (input.authenticated) return "ALLOW_ADMIN";
    if (!input.production && !configured) return "LOCAL_LOGIN";
    return "NOT_FOUND";
  }
  return "PASS";
}
