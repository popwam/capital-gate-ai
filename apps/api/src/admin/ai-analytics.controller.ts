import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AdminAuthGuard } from "../auth/admin-auth.guard";
import { AIUsageService } from "../providers/ai-usage.service";
import { PromptABTestingService } from "../providers/prompt-ab-testing.service";
import { PrismaService } from "../database/prisma.service";

@Controller("admin/ai-analytics")
@UseGuards(AdminAuthGuard)
@Throttle({ default: { limit: 5, ttl: 60_000 } })
export class AIAnalyticsController {
  constructor(
    private readonly usage: AIUsageService,
    private readonly abTesting: PromptABTestingService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Overall AI health dashboard
   */
  @Get()
  async dashboard(@Query("days") days?: string) {
    const sinceDays = days ? parseInt(days, 10) : 7;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);

    // Overall success rate
    const overall = await this.prisma.aIUsage.groupBy({
      by: ["success"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const totalRequests = overall.reduce((sum, r) => sum + r._count._all, 0);
    const successRequests = overall.find((r) => r.success)?._count._all ?? 0;
    const overallSuccessRate = totalRequests > 0 ? successRequests / totalRequests : 0;

    // Success rate by provider
    const byProvider = await this.prisma.aIUsage.groupBy({
      by: ["provider", "success"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _avg: { latencyMs: true },
    });

    const providerStats = byProvider.reduce((acc, row) => {
      if (!acc[row.provider]) {
        acc[row.provider] = { total: 0, success: 0, avgLatency: 0, successRate: 0 };
      }
      acc[row.provider].total += row._count._all;
      if (row.success) {
        acc[row.provider].success += row._count._all;
        acc[row.provider].avgLatency = row._avg.latencyMs ?? 0;
      }
      return acc;
    }, {} as Record<string, { total: number; success: number; avgLatency: number; successRate: number }>);

    Object.keys(providerStats).forEach((provider) => {
      const stats = providerStats[provider];
      stats.successRate = stats.total > 0 ? stats.success / stats.total : 0;
    });

    // Fallback rate
    const fallbacks = await this.prisma.aIUsage.groupBy({
      by: ["fallbackUsed"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    });

    const fallbackCount = fallbacks.find((r) => r.fallbackUsed)?._count._all ?? 0;
    const fallbackRate = totalRequests > 0 ? fallbackCount / totalRequests : 0;

    // Latency percentiles (approximate via averages by task type)
    const latency = await this.prisma.aIUsage.groupBy({
      by: ["taskType"],
      where: { createdAt: { gte: since }, success: true },
      _avg: { latencyMs: true },
    });

    // Top errors - use findMany + group manually since groupBy with take requires orderBy
    const errorRecords = await this.prisma.aIUsage.findMany({
      where: { createdAt: { gte: since }, success: false, errorCode: { not: null } },
      select: { errorCode: true },
    });

    const errorCounts = errorRecords.reduce((acc, r) => {
      const code = r.errorCode!;
      acc[code] = (acc[code] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const errors = Object.entries(errorCounts)
      .map(([errorCode, count]) => ({ errorCode, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Token usage by task type
    const tokens = await this.prisma.aIUsage.groupBy({
      by: ["taskType"],
      where: {
        createdAt: { gte: since },
        inputTokens: { not: null },
        outputTokens: { not: null },
      },
      _sum: { inputTokens: true, outputTokens: true },
    });

    return {
      period: { days: sinceDays, since },
      overall: {
        totalRequests,
        successRate: overallSuccessRate,
        fallbackRate,
      },
      byProvider: providerStats,
      latency: latency.map((r) => ({ taskType: r.taskType, avgLatencyMs: r._avg.latencyMs })),
      errors,
      tokens: tokens.map((r) => ({
        taskType: r.taskType,
        inputTokens: r._sum.inputTokens,
        outputTokens: r._sum.outputTokens,
      })),
    };
  }

  /**
   * A/B test results for a specific prompt
   */
  @Get("ab-test")
  async abTest(@Query("prompt") prompt: string, @Query("days") days?: string) {
    const promptKey = prompt || "advisor-system";
    const sinceDays = days ? parseInt(days, 10) : 7;
    const results = await this.abTesting.getResults(promptKey, sinceDays);
    return { promptKey, period: { days: sinceDays }, results };
  }

  /**
   * Time-series data for charting (daily buckets)
   */
  @Get("time-series")
  async timeSeries(@Query("days") days?: string) {
    const sinceDays = days ? parseInt(days, 10) : 7;
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60_000);

    const raw = await this.prisma.aIUsage.findMany({
      where: { createdAt: { gte: since } },
      select: {
        createdAt: true,
        success: true,
        fallbackUsed: true,
        latencyMs: true,
        provider: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // Bucket by day
    const buckets = new Map<string, { success: number; fail: number; fallback: number; latencies: number[] }>();

    raw.forEach((row) => {
      const day = row.createdAt.toISOString().split("T")[0];
      if (!buckets.has(day)) {
        buckets.set(day, { success: 0, fail: 0, fallback: 0, latencies: [] });
      }
      const bucket = buckets.get(day)!;
      if (row.success) {
        bucket.success++;
      } else {
        bucket.fail++;
      }
      if (row.fallbackUsed) {
        bucket.fallback++;
      }
      bucket.latencies.push(row.latencyMs);
    });

    const series = Array.from(buckets.entries()).map(([day, data]) => {
      const total = data.success + data.fail;
      const successRate = total > 0 ? data.success / total : 0;
      const fallbackRate = total > 0 ? data.fallback / total : 0;
      const avgLatency = data.latencies.length > 0
        ? data.latencies.reduce((sum, v) => sum + v, 0) / data.latencies.length
        : 0;
      return {
        day,
        successRate,
        fallbackRate,
        avgLatencyMs: avgLatency,
        totalRequests: total,
      };
    });

    return { period: { days: sinceDays, since }, series };
  }

  /**
   * Recent failed requests for debugging
   */
  @Get("recent-failures")
  async recentFailures(@Query("limit") limit?: string) {
    const take = limit ? parseInt(limit, 10) : 20;

    const failures = await this.prisma.aIUsage.findMany({
      where: { success: false },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        createdAt: true,
        provider: true,
        model: true,
        taskType: true,
        errorCode: true,
        latencyMs: true,
        conversationId: true,
      },
    });

    return { failures };
  }
}
