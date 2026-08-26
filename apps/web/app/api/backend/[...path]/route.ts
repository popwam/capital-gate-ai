import { forwardInternalApiRequest } from "@/lib/internal-api-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return forwardInternalApiRequest(request, path);
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const DELETE = forward;
