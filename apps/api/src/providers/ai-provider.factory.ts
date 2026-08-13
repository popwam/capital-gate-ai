import { Logger } from "@nestjs/common";
import { DemoAIProvider } from "./demo.provider";
import { HybridAIProvider } from "./hybrid.provider";

export function createAIProvider(hybrid: HybridAIProvider, demo: DemoAIProvider) {
  const provider = (process.env.AI_PROVIDER ?? (process.env.NODE_ENV === "production" ? "hybrid" : "demo")).toLowerCase();
  if (provider === "hybrid") {
    hybrid.validateConfiguration();
    return hybrid;
  }
  if (provider !== "demo") throw new Error(`Unsupported AI_PROVIDER: ${provider}`);
  if (process.env.NODE_ENV === "production") throw new Error("DemoAIProvider is disabled in production");
  new Logger("AIProvider").warn("Using development-only DemoAIProvider");
  return demo;
}
