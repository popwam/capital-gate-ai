import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async status() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "ok", service: "nadim-automation-api" };
    } catch {
      throw new ServiceUnavailableException({
        code: "DATABASE_UNAVAILABLE",
        message: "Database health check failed",
      });
    }
  }
}
