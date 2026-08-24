import { CanActivate, ExecutionContext, Inject, Injectable, OnModuleInit, Optional, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

@Injectable()
export class AutomationSecretGuard implements CanActivate, OnModuleInit {
  private readonly configuredSecret?: string;

  constructor(@Optional() @Inject("NADIM_AUTOMATION_SECRET_VALUE") configuredSecret?: string) {
    this.configuredSecret = configuredSecret ?? process.env.NADIM_AUTOMATION_SECRET;
  }

  onModuleInit() {
    if (!this.configuredSecret) {
      throw new Error("NADIM_AUTOMATION_SECRET must be configured");
    }
  }

  canActivate(context: ExecutionContext) {
    if (!this.configuredSecret) return this.reject();
    const value = context.switchToHttp().getRequest().headers["x-nadim-automation-secret"];
    const supplied = Array.isArray(value) ? value[0] : value;
    if (typeof supplied !== "string" || !timingSafeEqual(digest(supplied), digest(this.configuredSecret))) {
      return this.reject();
    }
    return true;
  }

  private reject(): never {
    throw new UnauthorizedException({
      ok: false,
      action: "LEAD_UPSERT",
      error: { code: "UNAUTHORIZED", message: "Invalid automation credentials" },
    });
  }
}
