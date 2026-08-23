import * as assert from "node:assert/strict";
import { test } from "node:test";
import { HybridAIProvider } from "./hybrid.provider";
import { AIUpstreamError } from "./provider-utils";

const input = { messages: [{ role: "user" as const, content: "عاوز شقة" }], intent: { language: "ar-EG" }, verifiedFacts: [] };

process.env.OPENAI_FALLBACK_ENABLED = "true";
process.env.OPENAI_API_KEY = "test-openai-key";
process.env.OPENAI_TEXT_MODEL = "test-openai-model";

test("uses Groq once for a normal customer answer", async () => {
  let groqCalls = 0, openaiCalls = 0;
  const provider = new HybridAIProvider({} as any, { composeAnswerWithModel: async () => { groqCalls++; return "تمام"; } } as any, { composeAnswer: async () => { openaiCalls++; return "fallback"; } } as any);
  assert.equal(await provider.composeAnswer(input), "تمام");
  assert.equal(groqCalls, 1); assert.equal(openaiCalls, 0);
});

test("falls back to OpenAI for retryable Groq errors", async () => {
  const provider = new HybridAIProvider({} as any, { composeAnswerWithModel: async () => { throw new AIUpstreamError("groq", "HTTP_503", 503, true); } } as any, { composeAnswer: async () => "بديل" } as any);
  assert.equal(await provider.composeAnswer(input), "بديل");
});

test("Groq 413 rebuilds an aggressive context once and succeeds", async()=>{const levels:string[]=[];const groq={composeAnswerWithModel:async(value:any)=>{levels.push(value.compactionLevel??"normal");if(levels.length===1)throw new AIUpstreamError("groq","HTTP_413",413,false);return"compact success";}};const provider=new HybridAIProvider({} as any,groq as any,{composeAnswer:async()=>{throw new Error("must not fallback")}} as any);assert.equal(await provider.composeAnswer({...input,verifiedFacts:Array(8).fill({id:"unit",description:"x".repeat(10000)})}),"compact success");assert.deepEqual(levels,["normal","aggressive"]);});

test("all routed Groq 413 responses use compact OpenAI fallback",async()=>{let groqCalls=0;let openaiLevel="";const provider=new HybridAIProvider({} as any,{composeAnswerWithModel:async()=>{groqCalls++;throw new AIUpstreamError("groq","HTTP_413",413,false)}} as any,{composeAnswer:async(value:any)=>{openaiLevel=value.compactionLevel;return"openai compact"}} as any);assert.equal(await provider.composeAnswer(input),"openai compact");assert.ok(groqCalls>=2);assert.equal(openaiLevel,"aggressive");});

test("Workers generates from compact context when Groq and OpenAI fail",async()=>{let workersLevel="";const workers={primaryModel:"workers-primary",composeAnswer:async(value:any)=>{workersLevel=value.compactionLevel;return"workers compact"}};const provider=new HybridAIProvider(workers as any,{composeAnswerWithModel:async()=>{throw new AIUpstreamError("groq","HTTP_413",413,false)}} as any,{composeAnswer:async()=>{throw new AIUpstreamError("openai","HTTP_503",503,true)}} as any);assert.equal(await provider.composeAnswer(input),"workers compact");assert.equal(workersLevel,"aggressive");});

test("all provider failures preserve the terminal upstream category",async()=>{const workers={primaryModel:"workers-primary",composeAnswer:async()=>{throw new AIUpstreamError("workers","HTTP_503",503,true)}};const provider=new HybridAIProvider(workers as any,{composeAnswerWithModel:async()=>{throw new AIUpstreamError("groq","HTTP_413",413,false)}} as any,{composeAnswer:async()=>{throw new AIUpstreamError("openai","HTTP_503",503,true)}} as any);await assert.rejects(()=>provider.composeAnswer(input),(error:any)=>error.getResponse().category==="HTTP_503"&&error.getResponse().provider==="workers");});

test("Groq stream retries 413 once with compact context",async()=>{const levels:string[]=[];const groq={streamAnswerWithModel:async function*(value:any){levels.push(value.compactionLevel??"normal");if(levels.length===1)throw new AIUpstreamError("groq","HTTP_413",413,false);yield"stream success";}};const provider=new HybridAIProvider({} as any,groq as any,{} as any);let result="";for await(const chunk of provider.streamAnswer(input))result+=chunk;assert.equal(result,"stream success");assert.deepEqual(levels,["normal","aggressive"]);});

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
