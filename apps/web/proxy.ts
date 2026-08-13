import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
  const token = request.cookies.get("maqar_admin_session")?.value;
  const loginUrl = new URL("/admin/login", request.url);
  if (!token) return NextResponse.redirect(loginUrl);
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return NextResponse.redirect(loginUrl);
  try { await jwtVerify(token, new TextEncoder().encode(secret), { issuer: "maqar-api", audience: "maqar-admin" }); return NextResponse.next(); }
  catch { const response = NextResponse.redirect(loginUrl); response.cookies.delete("maqar_admin_session"); return response; }
}

export const config = { matcher: ["/admin", "/admin/((?!login).*)"] };
