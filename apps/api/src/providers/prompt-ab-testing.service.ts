import { Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

/**
 * A/B Testing Service for Prompt Variants
 *
 * Assigns conversations to prompt variants and tracks the assignment
 * so every turn in a conversation uses the same variant.
 */
@Injectable()
export class PromptABTestingService {
  constructor(private readonly prisma: PrismaService) {}

  async nextVariant(): Promise<"control" | "experiment"> {
    const [controlCount, experimentCount] = await Promise.all([
      this.prisma.conversation.count({ where: { promptVariant: "control" } }),
      this.prisma.conversation.count({ where: { promptVariant: "experiment" } }),
    ]);
    return controlCount <= experimentCount ? "control" : "experiment";
  }

  /**
   * Assign a variant to a conversation on first turn.
   * Uses simple round-robin for now; upgrade to stratified sampling later.
   */
  async assignVariant(conversationId: string, promptKey: string): Promise<string> {
    const existing = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { promptVariant: true },
    });

    if (existing?.promptVariant) {
      return existing.promptVariant;
    }

    const variant = await this.nextVariant();

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { promptVariant: variant },
    });

    return variant;
  }

  /**
   * Get the variant for a conversation and apply it to the registry.
   */
  async getVariant(conversationId: string, promptKey: string): Promise<string> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { promptVariant: true },
    });

    const variant = conversation?.promptVariant ?? "control";

    return variant;
  }

  /**
   * Get A/B test results for a given prompt key.
   */
  async getResults(promptKey: string, sinceDays = 7) {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);

    const results = await this.prisma.aIUsage.groupBy({
      by: ["promptVariant", "success"],
      where: {
        createdAt: { gte: since },
        taskType: "customer_answer",
      },
      _count: { _all: true },
      _avg: { latencyMs: true },
    });

    const controlSuccess = results.find((r) => r.promptVariant === "control" && r.success)?._count._all ?? 0;
    const controlFail = results.find((r) => r.promptVariant === "control" && !r.success)?._count._all ?? 0;
    const experimentSuccess = results.find((r) => r.promptVariant === "experiment" && r.success)?._count._all ?? 0;
    const experimentFail = results.find((r) => r.promptVariant === "experiment" && !r.success)?._count._all ?? 0;

    const controlTotal = controlSuccess + controlFail;
    const experimentTotal = experimentSuccess + experimentFail;

    return {
      control: {
        total: controlTotal,
        successRate: controlTotal > 0 ? controlSuccess / controlTotal : 0,
        avgLatencyMs: results.find((r) => r.promptVariant === "control" && r.success)?._avg.latencyMs ?? 0,
      },
      experiment: {
        total: experimentTotal,
        successRate: experimentTotal > 0 ? experimentSuccess / experimentTotal : 0,
        avgLatencyMs: results.find((r) => r.promptVariant === "experiment" && r.success)?._avg.latencyMs ?? 0,
      },
    };
  }
}
