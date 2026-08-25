import { BadRequestException, Body, Controller, Headers, Post, Req, UseGuards } from "@nestjs/common";
import { NadimTurnDto } from "./dto/nadim-turn.dto";
import { NadimV2Service } from "./nadim-v2.service";
import { NadimGatewayGuard } from "./security/nadim-gateway.guard";

@Controller("v2/nadim")
@UseGuards(NadimGatewayGuard)
export class NadimV2Controller {
  constructor(private readonly nadim: NadimV2Service) {}

  @Post("turn")
  turn(
    @Body() body: NadimTurnDto,
    @Req() request: { requestId?: string },
    @Headers("x-idempotency-key") headerKey?: string,
  ) {
    const metadataEventId = typeof body.metadata?.eventId === "string" ? body.metadata.eventId : undefined;
    const idempotencyKey = this.idempotencyKey(headerKey ?? metadataEventId);
    return this.nadim.turn(body, request.requestId, idempotencyKey);
  }

  private idempotencyKey(value?: string) {
    const normalized = value?.trim();
    if (!normalized) return undefined;
    if (normalized.length > 200) {
      throw new BadRequestException({ code: "INVALID_IDEMPOTENCY_KEY", message: "The idempotency key must not exceed 200 characters", safe: true });
    }
    return normalized;
  }
}
