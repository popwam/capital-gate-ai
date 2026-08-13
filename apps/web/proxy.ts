import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { adminAccessDecision } from "./lib/admin-access";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("maqar_admin_session")?.value;
  const secret = process.env.ADMIN_JWT_SECRET;
  let authenticated = false;
  if (token && secret) try { await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "maqar-api", audience: "maqar-admin" }); authenticated = true; } catch { authenticated = false; }
  const decision = adminAccessDecision({ pathname: request.nextUrl.pathname, configuredPath: process.env.ADMIN_ACCESS_PATH, production: process.env.NODE_ENV === "production", authenticated });
  if (decision === "PASS" || decision === "ALLOW_ADMIN") return NextResponse.next();
  if (decision === "PRIVATE_ENTRY") {
    if (authenticated) return NextResponse.redirect(new URL("/admin", request.url));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-maqar-private-entry", "1");
    return NextResponse.rewrite(new URL("/admin/login", request.url), { request: { headers: requestHeaders } });
  }
  if (decision === "LOCAL_LOGIN") return request.nextUrl.pathname === "/admin/login" ? NextResponse.next() : NextResponse.redirect(new URL("/admin/login", request.url));
  const response = new NextResponse(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (token && !authenticated) response.cookies.delete("maqar_admin_session");
  return response;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)"] };
