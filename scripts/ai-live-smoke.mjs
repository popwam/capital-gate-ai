import "dotenv/config";
import assert from "node:assert/strict";

const { CloudflareWorkersAIProvider } = await import("../apps/api/dist/providers/cloudflare-workers-ai.provider.js");
const { GroqProvider } = await import("../apps/api/dist/providers/groq.provider.js");
const { OpenAIProvider } = await import("../apps/api/dist/providers/openai.provider.js");
const { HybridAIProvider } = await import("../apps/api/dist/providers/hybrid.provider.js");
const { AIUpstreamError } = await import("../apps/api/dist/providers/provider-utils.js");

const workers = new CloudflareWorkersAIProvider();
const groq = new GroqProvider();
const openai = new OpenAIProvider();
workers.validateConfiguration(); groq.validateConfiguration(); openai.validateConfiguration();

const prompts = [
  "عاوز شقة في التجمع وميزانيتي 12 مليون",
  "I need a three bedroom apartment under 15 million EGP",
  "عاوز apartment 3 bedrooms في New Cairo",
];
const intents = [];
for (const content of prompts) intents.push(await workers.extractIntent([{ role: "user", content }], { language: "ar-EG" }));
assert.ok(intents.every(intent => intent.language));

const answerInput = { messages: [{ role: "user", content: "إيه المتاح؟" }], intent: { language: "ar-EG" }, verifiedFacts: [], approvedKnowledge: [] };
const answer = await groq.composeAnswer(answerInput); assert.ok(answer.length > 5);
let streamed = ""; for await (const chunk of groq.streamAnswer(answerInput)) streamed += chunk; assert.ok(streamed.length > 5);
const openaiAnswer = await openai.composeAnswer(answerInput); assert.ok(openaiAnswer.length > 5);

const failingGroq = { composeAnswer: async () => { throw new AIUpstreamError("groq", "HTTP_503", 503, true); } };
const noWorkersFallback = { composeAnswer: async () => { throw new Error("Workers fallback must not run in this assertion"); } };
const hybrid = new HybridAIProvider(noWorkersFallback, failingGroq, openai);
const fallback = await hybrid.composeAnswer(answerInput); assert.ok(fallback.length > 5);

console.log(JSON.stringify({ workersStructured: "PASS", arabic: "PASS", english: "PASS", mixed: "PASS", groqGeneration: "PASS", groqStreaming: "PASS", openaiFallback: "PASS" }));
