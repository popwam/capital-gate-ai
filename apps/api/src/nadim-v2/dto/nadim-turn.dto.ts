import { Transform } from "class-transformer";
import { IsIn, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export const NADIM_CHANNELS = ["WEB", "WHATSAPP", "PHONE", "N8N"] as const;
export type NadimChannel = (typeof NADIM_CHANNELS)[number];
export const NADIM_CONTROL_COMMANDS = ["REQUEST_HUMAN_HANDOFF", "RETURN_TO_AI", "REQUEST_CONVERSATION_DELETION", "CONFIRM_CONVERSATION_DELETION"] as const;
export type NadimControlCommand = (typeof NADIM_CONTROL_COMMANDS)[number];

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class NadimTurnDto {
  @IsIn(NADIM_CHANNELS)
  channel!: NadimChannel;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  conversationId?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(200)
  customerId?: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(300)
  externalUserId?: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(8_000)
  message!: string;

  @Transform(trim) @IsOptional() @IsString() @MaxLength(35)
  locale?: string;

  @IsOptional() @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional() @IsIn(NADIM_CONTROL_COMMANDS)
  controlCommand?: NadimControlCommand;
}
