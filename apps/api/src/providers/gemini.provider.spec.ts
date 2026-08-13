import * as assert from "node:assert/strict";
import { test } from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { SystemController } from "../admin/system.controller";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { createAIProvider } from "./ai-provider.factory";
import {
  classifyGeminiError,
  GeminiProvider,
  selectFlashModel,
} from "./gemini.provider";

function providerWith(models: Record<string, unknown>) {
  const priorKey = process.env.GEMINI_API_KEY;
  const priorModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-key-never-logged";
  process.env.GEMINI_MODEL = "gemini-2.5-flash";
  const provider = new GeminiProvider();
  (provider as any).client = { models };
  (provider as any).logger = { error() {}, warn() {} };
  if (priorKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = priorKey;
  if (priorModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = priorModel;
  return provider;
}

test("Gemini errors classify 404 and depleted-credit 429 separately", () => {
  assert.equal(
    classifyGeminiError({ status: 404, message: "model not found" }).category,
    "MODEL_OR_ENDPOINT_NOT_FOUND",
  );
  const quota = classifyGeminiError({
    status: 429,
    message: "Your prepayment credits are depleted.",
  });
  assert.equal(quota.category, "RESOURCE_EXHAUSTED");
  assert.equal(quota.creditsDepleted, true);
  assert.equal(quota.retryable, false);
});

test("Flash selection uses a generation-capable returned model", () => {
  assert.equal(
    selectFlashModel([
      {
        name: "gemini-2.5-flash-native-audio-latest",
        supportedGenerationMethods: ["bidiGenerateContent"],
      },
      {
        name: "gemini-flash-latest",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
    ]),
    "gemini-flash-latest",
  );
});

test("404 from a retired configured model selects the discovered Flash alias", async () => {
  const calls: string[] = [];
  const provider = providerWith({
    list: async () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          name: "models/gemini-flash-latest",
          supportedActions: ["generateContent"],
        };
      },
    }),
    generateContent: async ({ model }: any) => {
      calls.push(model);
      if (model === "gemini-2.5-flash")
        throw {
          status: 404,
          message: "This model is no longer available to new users.",
        };
      return { text: "Verified response" };
    },
  });

  const answer = await provider.composeAnswer({
    messages: [],
    intent: { language: "en" },
    verifiedFacts: [],
  });

  assert.equal(answer, "Verified response");
  assert.deepEqual(calls, ["gemini-2.5-flash", "gemini-flash-latest"]);
  assert.equal(provider.selectedModel, "gemini-flash-latest");
});

test("depleted-credit 429 is not retried", async () => {
  let calls = 0;
  const provider = providerWith({
    generateContent: async () => {
      calls++;
      throw { status: 429, message: "Prepayment credits are depleted." };
    },
  });

  await assert.rejects(
    () =>
      provider.composeAnswer({
        messages: [],
        intent: { language: "en" },
        verifiedFacts: [],
      }),
    (error: any) => {
      assert.equal(error.getResponse().category, "RESOURCE_EXHAUSTED");
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("intent extraction uses SDK structured JSON schema and preserves Arabic", async () => {
  let request: any;
  const provider = providerWith({
    generateContent: async (value: any) => {
      request = value;
      return {
        text: JSON.stringify({
          language: "ar-EG",
          locations: ["القاهرة الجديدة"],
          bedrooms: 3,
          purchaseIntent: 70,
        }),
      };
    },
  });

  const intent = await provider.extractIntent(
    [{ role: "user", content: "عاوز apartment 3 bedrooms في New Cairo" }],
    { language: "en" },
  );

  assert.equal(intent.language, "ar-EG");
  assert.deepEqual(intent.locations, ["القاهرة الجديدة"]);
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(request.config.responseJsonSchema.type, "object");
});

test("streaming uses the SDK stream without simulated chunks", async () => {
  const provider = providerWith({
    generateContentStream: async () =>
      (async function* () {
        yield { text: "أهلاً" };
        yield { text: " بك" };
      })(),
  });
  const chunks: string[] = [];
  for await (const chunk of provider.streamAnswer({
    messages: [],
    intent: { language: "ar-EG" },
    verifiedFacts: [],
  }))
    chunks.push(chunk);
  assert.deepEqual(chunks, ["أهلاً", " بك"]);
});

test("AI health diagnostics are protected by AdminAuthGuard", () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, SystemController) as unknown[];
  assert.ok(guards.includes(AdminAuthGuard));
});

test("Gemini diagnostics redact API keys", async () => {
  const logs: string[] = [];
  const provider = providerWith({
    generateContent: async () => {
      throw {
        status: 400,
        message: "Invalid request ?key=test-key-never-logged",
      };
    },
  });
  (provider as any).logger = {
    error: (message: string) => logs.push(message),
    warn() {},
  };
  await assert.rejects(() =>
    provider.composeAnswer({
      messages: [],
      intent: { language: "en" },
      verifiedFacts: [],
    }),
  );
  assert.equal(logs.some((line) => line.includes("test-key-never-logged")), false);
  assert.equal(logs.some((line) => line.includes("[REDACTED]")), true);
});

test("production cannot select DemoAIProvider", () => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorProvider = process.env.AI_PROVIDER;
  process.env.NODE_ENV = "production";
  process.env.AI_PROVIDER = "demo";
  try {
    assert.throws(
      () => createAIProvider({} as GeminiProvider, {} as any),
      /disabled in production/,
    );
  } finally {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = priorProvider;
  }
});
