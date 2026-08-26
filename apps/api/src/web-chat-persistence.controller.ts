import { BadRequestException, Body, Controller, Headers, Post, UseGuards } from "@nestjs/common";
import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { NadimGatewayGuard } from "./nadim-v2/security/nadim-gateway.guard";
import { WebChatPersistenceService } from "./web-chat-persistence.service";

class PersistNadimWebTurnDto {
  @IsString() @MinLength(1) @MaxLength(200) legacyConversationId!: string;
  @IsString() @MinLength(1) @MaxLength(200) nadimConversationId!: string;
  @IsString() @MinLength(1) @MaxLength(200) eventId!: string;
  @IsString() @IsNotEmpty() @MaxLength(8_000) userMessage!: string;
  @IsString() @IsNotEmpty() @MaxLength(32_000) assistantReply!: string;
  @IsOptional() @IsObject() resultMetadata?: Record<string, unknown>;
}

@Controller("internal/web-chat")
@UseGuards(NadimGatewayGuard)
export class WebChatPersistenceController {
  constructor(private readonly persistence: WebChatPersistenceService) {}

  @Post("persist")
  persist(@Headers("x-device-token") deviceToken: string | undefined, @Body() body: PersistNadimWebTurnDto) {
    if (!deviceToken || deviceToken.length < 20) {
      throw new BadRequestException("A valid x-device-token header is required");
    }
    return this.persistence.persist({ ...body, deviceToken });
  }
}
