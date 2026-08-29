import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from "@nestjs/common";
import { Transform } from "class-transformer";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { CustomerLifecycleService } from "./customer-lifecycle.service";
import { NadimGatewayGuard } from "../security/nadim-gateway.guard";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

class HumanActivityDto {
  @IsIn(["WHATSAPP"]) channel!: "WHATSAPP";
  @Transform(trim) @IsString() @MaxLength(300) externalUserId!: string;
  @IsOptional() @IsString() @MaxLength(300) providerMessageId?: string;
  @IsOptional() @IsString() @MaxLength(100) instance?: string;
  @Transform(({ value }) => typeof value === "number" ? String(value) : value) @IsOptional() @IsString() @MaxLength(100) occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(100) addressingMode?: string;
}

class ReleaseHumanDto { @IsNumber() @Min(1) @Max(720) inactiveForHours!: number; }
class ClaimDueDto {
  @Transform(trim) @IsString() @MaxLength(100) workerId!: string;
  @IsInt() @Min(1) @Max(100) limit!: number;
}
class FollowUpSentDto {
  @Transform(trim) @IsString() @MaxLength(80) provider!: string;
  @IsOptional() @IsString() @MaxLength(300) providerMessageId?: string | null;
}
class FollowUpFailedDto {
  @Transform(trim) @IsString() @MaxLength(80) provider!: string;
  @Transform(trim) @IsString() @MaxLength(1_000) reason!: string;
}
class CreateTokenDto {
  @IsIn(["WEB_SHARE", "WHATSAPP_HANDOFF", "WHATSAPP_JOIN"]) type!: "WEB_SHARE" | "WHATSAPP_HANDOFF" | "WHATSAPP_JOIN";
  @IsOptional() @IsInt() @Min(1) @Max(43_200) ttlMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100) maxUses?: number;
  @IsOptional() @IsString() @MaxLength(200) createdByParticipantId?: string;
}
class ConsumeTokenDto {
  @Transform(trim) @IsString() @MaxLength(200) token!: string;
  @IsIn(["WEB_SHARE", "WHATSAPP_HANDOFF", "WHATSAPP_JOIN"]) expectedType!: "WEB_SHARE" | "WHATSAPP_HANDOFF" | "WHATSAPP_JOIN";
  @IsIn(["WEB", "WHATSAPP"]) channel!: "WEB" | "WHATSAPP";
  @Transform(trim) @IsString() @MaxLength(300) externalUserId!: string;
}

@Controller("v2/internal")
@UseGuards(NadimGatewayGuard)
export class CustomerLifecycleController {
  constructor(private readonly lifecycle: CustomerLifecycleService) {}

  @Post("conversations/human-activity") @HttpCode(HttpStatus.OK)
  humanActivity(@Body() body: HumanActivityDto) { return this.lifecycle.recordHumanActivity(body); }

  @Post("conversations/release-stale-human") @HttpCode(HttpStatus.OK)
  releaseStale(@Body() body: ReleaseHumanDto) { return this.lifecycle.releaseStaleHuman(body.inactiveForHours); }

  @Post("followups/claim-due") @HttpCode(HttpStatus.OK)
  claimDue(@Body() body: ClaimDueDto) { return this.lifecycle.claimDue(body.workerId, body.limit); }

  @Post("followups/:id/sent") @HttpCode(HttpStatus.OK)
  sent(@Param("id") id: string, @Body() body: FollowUpSentDto) { return this.lifecycle.markSent(id, body.provider, body.providerMessageId); }

  @Post("followups/:id/failed") @HttpCode(HttpStatus.OK)
  failed(@Param("id") id: string, @Body() body: FollowUpFailedDto) { return this.lifecycle.markFailed(id, body.provider, body.reason); }

  @Post("conversations/:id/tokens")
  createToken(@Param("id") conversationId: string, @Body() body: CreateTokenDto) { return this.lifecycle.createToken({ conversationId, ...body }); }

  @Post("conversation-tokens/consume")
  consumeToken(@Body() body: ConsumeTokenDto) { return this.lifecycle.consumeToken(body); }

  @Post("conversations/:conversationId/tokens/:id/revoke")
  revokeToken(@Param("conversationId") conversationId: string, @Param("id") id: string) { return this.lifecycle.revokeToken(id, conversationId); }
}
