import { AIUpstreamError, parseJsonObject } from "./provider-utils";

export type MasterPlanSuggestion = {
  found: boolean;
  x?: number;
  y?: number;
  confidence?: number;
  matchedLabel?: string;
};

function clamp01(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : undefined;
}

export async function locateUnitOnMasterPlan(imageUrl: string, unitLabel: string): Promise<MasterPlanSuggestion> {
  const apiKey = process.env.GROQ_API_KEY ?? "";
  const model = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.6-27b";
  if (!apiKey) throw new AIUpstreamError("groq", "NOT_CONFIGURED", undefined, false);

  let response: Response;
  try {
    response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 450,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "You locate an explicitly labeled real-estate unit on a master-plan image. Return JSON only. Never guess. x and y are normalized 0..1 coordinates measured from the image top-left. If the exact label cannot be located confidently return found=false.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Find the exact unit label: ${unitLabel}. Return {\"found\":boolean,\"x\":number,\"y\":number,\"confidence\":number,\"matchedLabel\":string}. Coordinates should point to the center of the exact unit footprint/label.` },
              { type: "image_url", image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch {
    throw new AIUpstreamError("groq", "NETWORK", undefined, true);
  }

  if (!response.ok) throw new AIUpstreamError("groq", `HTTP_${response.status}`, response.status, response.status === 429 || response.status >= 500);
  const body = await response.json() as any;
  const parsed = parseJsonObject(body.choices?.[0]?.message?.content ?? "{}", "groq") as Record<string, unknown>;
  const found = parsed.found === true;
  const x = clamp01(parsed.x);
  const y = clamp01(parsed.y);
  const confidence = clamp01(parsed.confidence);
  if (!found || x == null || y == null || (confidence ?? 0) < 0.55) return { found: false, confidence, matchedLabel: typeof parsed.matchedLabel === "string" ? parsed.matchedLabel : undefined };
  return { found: true, x, y, confidence, matchedLabel: typeof parsed.matchedLabel === "string" ? parsed.matchedLabel : unitLabel };
}
