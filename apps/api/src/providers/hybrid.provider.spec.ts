import * as assert from "node:assert/strict";
import { test } from "node:test";
import { HybridAIProvider } from "./hybrid.provider";
import { AIUpstreamError } from "./provider-utils";

const input = { messages: [{ role: "user" as const, content: "عاوز شقة" }], intent: { language: "ar-EG" }, verifiedFacts: [] };

test("uses Groq once for a normal customer answer", async () => {
  let groqCalls = 0, openaiCalls = 0;
  const provider = new HybridAIProvider({} as any, { composeAnswer: async () => { groqCalls++; return "تمام"; } } as any, { composeAnswer: async () => { openaiCalls++; return "fallback"; } } as any);
  assert.equal(await provider.composeAnswer(input), "تمام");
  assert.equal(groqCalls, 1); assert.equal(openaiCalls, 0);
});

test("falls back to OpenAI for retryable Groq errors", async () => {
  const provider = new HybridAIProvider({} as any, { composeAnswer: async () => { throw new AIUpstreamError("groq", "HTTP_503", 503, true); } } as any, { composeAnswer: async () => "بديل" } as any);
  assert.equal(await provider.composeAnswer(input), "بديل");
});

test("Workers failure does not block deterministic intent or column ingestion", async () => {
  const workers = { extractIntent: async () => { throw new Error("down"); }, mapColumns: async () => { throw new Error("down"); } };
  const provider = new HybridAIProvider(workers as any, {} as any, {} as any);
  const intent = await provider.extractIntent([{ role: "user", content: "ميزانيتي 12 مليون" }], { language: "ar-EG" });
  assert.equal(intent.budgetMax, 12_000_000);
  assert.deepEqual(await provider.mapColumns(["mystery"], [], ["price"]), []);
});

test("explicit media requests are preserved when structured extraction omits them", async () => {
  const workers = {
    fastModel: "fast",
    extractIntent: async () => ({ language: "ar-EG" }),
  };
  const provider = new HybridAIProvider(workers as any, {} as any, {} as any);
  const intent = await provider.extractIntent(
    [{ role: "user", content: "وريني صور" }],
    { language: "ar-EG" },
  );
  assert.equal(intent.requestedMedia, "IMAGES");
});

test("media intent is per-message and does not leak into the next turn", async () => {
  const workers = {
    fastModel: "fast",
    extractIntent: async () => ({ language: "ar-EG", requestedMedia: "IMAGES" }),
  };
  const provider = new HybridAIProvider(workers as any, {} as any, {} as any);
  const intent = await provider.extractIntent(
    [{ role: "user", content: "طب والسداد؟" }],
    { language: "ar-EG", requestedMedia: "IMAGES" },
  );
  assert.equal(intent.requestedMedia, undefined);
});

test("explicit purchase intent and contact details survive structured omissions", async () => {
  const workers = {
    fastModel: "fast",
    extractIntent: async () => ({ language: "ar-EG" }),
  };
  const provider = new HybridAIProvider(workers as any, {} as any, {} as any);
  const intent = await provider.extractIntent(
    [
      {
        role: "user",
        content: "أنا جاهز أشتري. اسمي Test Buyer ورقمي +201000000000",
      },
    ],
    { language: "ar-EG" },
  );
  assert.equal(intent.purchaseIntent, 90);
  assert.equal(intent.contactName, "Test Buyer");
  assert.equal(intent.contactPhone, "+201000000000");
});

test("explicit route endpoints survive structured omissions", async () => {
  const workers = {
    fastModel: "fast",
    extractIntent: async () => ({ language: "ar-EG" }),
  };
  const provider = new HybridAIProvider(workers as any, {} as any, {} as any);
  const intent = await provider.extractIntent(
    [{ role: "user", content: "المسافة من التجمع إلى AUC كام؟" }],
    { language: "ar-EG" },
  );
  assert.equal(intent.exactRouteRequested, true);
  assert.equal(intent.routeOrigin, "التجمع");
  assert.equal(intent.routeDestination, "AUC");
});
