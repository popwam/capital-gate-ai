import { CanActivate, ExecutionContext, Injectable, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

@Injectable()
export class NadimGatewayGuard implements CanActivate, OnModuleInit {
  onModuleInit() {
    if (process.env.NADIM_V2_ENABLED === "true" && !process.env.NADIM_GATEWAY_SECRET) {
      throw new Error("NADIM_GATEWAY_SECRET must be configured when Nadim V2 is enabled");
    }
  }

  canActivate(context: ExecutionContext) {
    const expected = process.env.NADIM_GATEWAY_SECRET;
    const raw = context.switchToHttp().getRequest().headers["x-nadim-gateway-secret"];
    const supplied = Array.isArray(raw) ? raw[0] : raw;
    if (!expected || typeof supplied !== "string" || !timingSafeEqual(digest(expected), digest(supplied))) {
      throw new UnauthorizedException({ code: "NADIM_GATEWAY_UNAUTHORIZED", message: "Invalid Nadim gateway credentials", safe: true });
    }
    return true;
  }
}
