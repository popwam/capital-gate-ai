import { NextResponse } from "next/server";
import { forwardNadimProduct } from "@/lib/nadim-product-server";
import { NadimWebAdapterError } from "@/lib/nadim-server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const deviceToken = typeof body.deviceToken === "string" ? body.deviceToken : "";
    if (deviceToken.length < 20) throw new NadimWebAdapterError(400, "A valid device token is required", "INVALID_DEVICE_TOKEN");
    return NextResponse.json(await forwardNadimProduct("/v1/internal/web-chat/conversation-action", { legacyConversationId: body.legacyConversationId, action: body.action }, deviceToken));
  } catch (error) {
    const known = error instanceof NadimWebAdapterError ? error : new NadimWebAdapterError(502, "The conversation action failed", "NADIM_PRODUCT_ACTION_FAILED");
    return NextResponse.json({ code: known.code, message: known.message }, { status: known.status });
  }
}
