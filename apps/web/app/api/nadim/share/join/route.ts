import { NextResponse } from "next/server";
import { forwardNadimProduct } from "@/lib/nadim-product-server";
import { NadimWebAdapterError } from "@/lib/nadim-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken : "";
    const token = typeof body.token === "string" ? body.token : "";
    if (deviceToken.length < 20 || token.length < 20) throw new NadimWebAdapterError(400, "This conversation link is invalid", "INVALID_SHARE_LINK");
    return NextResponse.json(await forwardNadimProduct("/v1/internal/web-chat/join-shared", { token }, deviceToken));
  } catch (error) {
    const known = error instanceof NadimWebAdapterError ? error : new NadimWebAdapterError(502, "The conversation link could not be opened", "SHARE_JOIN_FAILED");
    return NextResponse.json({ code: known.code, message: known.message }, { status: known.status });
  }
}
