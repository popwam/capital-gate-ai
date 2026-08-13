import { Injectable } from "@nestjs/common";
import { PrismaService } from "./database/prisma.service";

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  record(adminUserId: string | undefined, action: string, entityType: string, entityId?: string, metadata?: unknown) {
    return this.prisma.auditLog.create({ data: { adminUserId, action, entityType, entityId, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined } });
  }
}
