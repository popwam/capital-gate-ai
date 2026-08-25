import { Controller, Get, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { HybridAIProvider } from "../providers/hybrid.provider";
import { AIUsageService } from "../providers/ai-usage.service";
import { DialogueModelService } from "../nadim-v2/providers/dialogue-model.service";

@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
@Controller("admin/system")
export class SystemController {
  constructor(private readonly hybrid: HybridAIProvider, private readonly usage: AIUsageService, private readonly nadimDialogue: DialogueModelService) {}

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

  @Get("nadim-v2-ai-health")
  nadimV2AiHealth() { return this.nadimDialogue.health(); }
}
