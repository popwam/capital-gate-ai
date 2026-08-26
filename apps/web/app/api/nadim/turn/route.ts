import { NextResponse } from "next/server";
import { checkNadimWebRateLimit, forwardNadimWebTurn, NadimWebAdapterError, parseNadimWebTurnInput } from "@/lib/nadim-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = parseNadimWebTurnInput(await request.json().catch(() => null));
    checkNadimWebRateLimit(input.deviceToken);
    return NextResponse.json(await forwardNadimWebTurn(input));
  } catch (error) {
    if (error instanceof NadimWebAdapterError) {
      return NextResponse.json(
        { code: error.code, message: error.message, requestId: error.requestId },
        { status: error.status },
      );
    }
    return NextResponse.json({ code: "NADIM_WEB_GATEWAY_FAILED", message: "Nadim is temporarily unavailable" }, { status: 502 });
  }
}
