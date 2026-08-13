import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class AIUsageService {
  private readonly logger = new Logger(AIUsageService.name);
  constructor(private readonly prisma: PrismaService) {}
  async record(data: { provider: string; model: string; taskType: string; latencyMs: number; success: boolean; fallbackUsed?: boolean; errorCode?: string; inputTokens?: number; outputTokens?: number }) {
    try { await this.prisma.aIUsage.create({ data: { ...data, fallbackUsed: data.fallbackUsed ?? false } }); }
    catch { this.logger.warn(`AI usage record failed provider=${data.provider} task=${data.taskType}`); }
  }
  async stats() {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
    const [byProvider, recent] = await Promise.all([
      this.prisma.aIUsage.groupBy({ by: ["provider", "success"], where: { createdAt: { gte: since } }, _count: { _all: true }, _avg: { latencyMs: true } }),
      this.prisma.aIUsage.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50, select: { provider: true, model: true, taskType: true, latencyMs: true, success: true, fallbackUsed: true, errorCode: true, createdAt: true } }),
    ]);
    return { periodDays: 7, byProvider, recent };
  }
}
