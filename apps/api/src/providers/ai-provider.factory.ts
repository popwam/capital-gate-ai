import { Logger } from "@nestjs/common";
import { DemoAIProvider } from "./demo.provider";
import { GeminiProvider } from "./gemini.provider";

export function createAIProvider(gemini: GeminiProvider, demo: DemoAIProvider) {
  const provider = (process.env.AI_PROVIDER ?? (process.env.NODE_ENV === "production" ? "gemini" : "demo")).toLowerCase();
  if (provider === "gemini") {
    if (!process.env.GEMINI_API_KEY) throw new Error("AI_PROVIDER=gemini requires GEMINI_API_KEY");
    return gemini;
  }
  if (provider !== "demo") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  if (process.env.NODE_ENV === "production") throw new Error("DemoAIProvider is disabled in production");
  new Logger("AIProvider").warn("Using development-only DemoAIProvider");
  return demo;
}
