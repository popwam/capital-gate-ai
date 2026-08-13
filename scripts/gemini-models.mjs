import { GoogleGenAI } from "@google/genai";

if (!process.env.GEMINI_API_KEY && process.loadEnvFile) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // Railway and CI normally provide environment variables directly.
  }
}

if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required");
}

const client = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  apiVersion: "v1beta",
});
const pager = await client.models.list({ config: { pageSize: 100 } });
for await (const model of pager) {
  if (!model.name) continue;
  console.log(`${model.name}\t${(model.supportedActions ?? []).join(",")}`);
}
