import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { GeminiProvider } from "../providers/gemini.provider";

@UseGuards(AdminAuthGuard)
@Controller("admin/system")
export class SystemController {
  constructor(private readonly gemini: GeminiProvider) {}

  @Get("ai-health")
  aiHealth() {
    if ((process.env.AI_PROVIDER ?? "demo").toLowerCase() !== "gemini") {
      return {
        provider: "demo",
        configuredModel: null,
        selectedModel: null,
        modelAvailable: false,
        generationSupported: false,
        status: "development-only",
      };
    }
    return this.gemini.health();
  }
}
