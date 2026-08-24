import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AutomationError } from "../common/automation-error";
import { PrismaService } from "../database/prisma.service";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(request: unknown) {
  return createHash("sha256").update(canonical(request), "utf8").digest("hex");
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async claim(idempotencyKey: string, source: string, request: unknown) {
    const hash = requestHash(request);
    try {
      const execution = await this.prisma.automationActionExecution.create({ data: {
        idempotencyKey,
        actionType: "LEAD_UPSERT",
        source,
        requestHash: hash,
        requestPayload: json(request),
        status: "PENDING",
      } });
      return { execution, hash };
    } catch (error) {
      if ((error as { code?: string })?.code !== "P2002") throw error;
      const existing = await this.prisma.automationActionExecution.findUnique({ where: { idempotencyKey } });
      if (!existing || existing.requestHash !== hash) {
        throw new AutomationError("IDEMPOTENCY_CONFLICT", "The idempotency key was already used for a different request", 409);
      }
      if (!existing.responsePayload) {
        throw new AutomationError("ACTION_IN_PROGRESS", "An identical action with this idempotency key is still in progress", 409);
      }
      return { execution: existing, hash, replay: { ...(existing.responsePayload as object), replayed: true } };
    }
  }

  complete(tx: Prisma.TransactionClient, id: string, response: unknown, entity: { type: "Lead" | "Customer"; id: string }) {
    return tx.automationActionExecution.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        responsePayload: json(response),
        entityType: entity.type,
        entityId: entity.id,
        completedAt: new Date(),
      },
    });
  }

  fail(id: string, response: unknown, errorCode: string) {
    return this.prisma.automationActionExecution.update({
      where: { id },
      data: { status: "FAILED", responsePayload: json(response), errorCode, completedAt: new Date() },
    });
  }
}
