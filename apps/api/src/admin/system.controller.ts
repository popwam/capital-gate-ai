import { Controller, Get, UseGuards } from "@nestjs/common";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { HybridAIProvider } from "../providers/hybrid.provider";
import { AIUsageService } from "../providers/ai-usage.service";

@UseGuards(AdminAuthGuard)
@Controller("admin/system")
export class SystemController {
  constructor(private readonly hybrid: HybridAIProvider, private readonly usage: AIUsageService) {}

  @Get("ai-health")
  aiHealth() {
    if ((process.env.AI_PROVIDER ?? "demo").toLowerCase() !== "hybrid") {
      return {
        provider: "demo",
        configuredModel: null,
        selectedModel: null,
        modelAvailable: false,
        generationSupported: false,
        status: "development-only",
      };
    }
    return this.hybrid.health();
  }

  @Get("ai-usage")
  aiUsage() { return this.usage.stats(); }
}
