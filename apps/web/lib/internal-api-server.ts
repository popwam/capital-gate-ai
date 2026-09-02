type ServerEnvironment = Record<string, string | undefined>;

const CUSTOMER_ROUTES: ReadonlyArray<{ pattern: RegExp; methods: ReadonlySet<string> }> = [
  { pattern: /^v1\/conversations$/u, methods: new Set(["GET", "POST"]) },
  { pattern: /^v1\/conversations\/[^/]+$/u, methods: new Set(["PATCH", "DELETE"]) },
  { pattern: /^v1\/conversations\/[^/]+\/messages$/u, methods: new Set(["GET"]) },
] as const;

export function internalApiBaseUrl(environment: ServerEnvironment = process.env) {
  const configured = environment.INTERNAL_API_URL?.trim() || environment.NADIM_API_URL?.trim();
  const raw = configured || (environment.NODE_ENV === "production" ? "" : "http://localhost:8080");
  if (!raw) throw new Error("INTERNAL_API_URL is required in production");
  const url = new URL(raw);
  if (!/^https?:$/.test(url.protocol)) throw new Error("INTERNAL_API_URL must use HTTP or HTTPS");
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function isAllowedInternalApiRequest(path: string, method: string) {
  const normalizedMethod = method.toUpperCase();
  if (/^v1\/admin(?:\/|$)/u.test(path)) return ["GET", "POST", "PATCH", "DELETE"].includes(normalizedMethod);
  return CUSTOMER_ROUTES.some(route => route.pattern.test(path) && route.methods.has(normalizedMethod));
}

function forwardedRequestHeaders(request: Request) {
  const headers = new Headers();
  for (const name of ["content-type", "cookie", "x-device-token", "x-request-id"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function hostOnlyCookie(value: string) {
  return value.replace(/;\s*Domain=[^;]+/giu, "");
}

export async function forwardInternalApiRequest(
  request: Request,
  segments: string[],
  fetcher: typeof fetch = fetch,
  environment: ServerEnvironment = process.env,
) {
  if (segments.some(segment => !segment || segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) {
    return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });
  }
  const path = segments.map(encodeURIComponent).join("/");
  if (!isAllowedInternalApiRequest(path, request.method)) {
    return Response.json({ code: "NOT_FOUND", message: "Not found" }, { status: 404 });
  }

  const incomingUrl = new URL(request.url);
  let upstreamUrl: string;
  try {
    upstreamUrl = `${internalApiBaseUrl(environment)}/${path}${incomingUrl.search}`;
  } catch {
    return Response.json({ code: "INTERNAL_API_NOT_CONFIGURED", message: "The service is temporarily unavailable" }, { status: 503 });
  }
  let upstream: Response;
  try {
    upstream = await fetcher(upstreamUrl, {
      method: request.method,
      headers: forwardedRequestHeaders(request),
      body: ["GET", "HEAD"].includes(request.method.toUpperCase()) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(180_000),
    });
  } catch {
    return Response.json({ code: "INTERNAL_API_UNAVAILABLE", message: "The service is temporarily unavailable" }, { status: 502 });
  }

  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "x-request-id", "cache-control"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  const upstreamHeaders = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = upstreamHeaders.getSetCookie?.() ?? (upstream.headers.get("set-cookie") ? [upstream.headers.get("set-cookie")!] : []);
  for (const cookie of cookies) headers.append("set-cookie", hostOnlyCookie(cookie));
  return new Response(upstream.body, { status: upstream.status, headers });
}
