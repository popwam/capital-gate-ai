import { LeadIntent } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import { IsDateString, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";

export const AUTOMATION_SOURCES = ["WEB_CHAT", "WHATSAPP", "PHONE", "N8N", "OTHER"] as const;
export const CUSTOMER_CHANNELS = ["WEB", "WHATSAPP", "PHONE"] as const;
export type AutomationSource = (typeof AUTOMATION_SOURCES)[number];
export type CustomerChannel = (typeof CUSTOMER_CHANNELS)[number];

export class CustomerInputDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @Transform(({ value }) => typeof value === "string" ? value.trim() : value)
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(300) channelExternalId?: string;
}

export class LeadInputDto {
  @IsOptional() @IsEnum(LeadIntent) intent?: LeadIntent;
  @IsOptional() @IsInt() @Min(0) @Max(100) intentScore?: number;
  @IsOptional() @IsString() @MaxLength(120) purpose?: string;
  @IsOptional() @IsNumber() @Min(0) budgetMin?: number;
  @IsOptional() @IsNumber() @Min(0) budgetMax?: number;
  @IsOptional() @IsString() @MaxLength(12) currency?: string;
  @IsOptional() @IsString() @MaxLength(50) preferredContactChannel?: string;
  @IsOptional() @IsString() @MaxLength(50) preferredConfirmationChannel?: string;
  @IsOptional() @IsDateString() followUpAt?: string;
  @IsOptional() @IsString() @MaxLength(4_000) notes?: string;
}

export class AutomationContextDto {
  @IsOptional() @IsString() @MaxLength(200) conversationId?: string;
  @IsOptional() @IsString() @MaxLength(300) externalChannelId?: string;
  @IsOptional() @IsString() @MaxLength(300) eventId?: string;
  @IsOptional() @IsObject() metadata?: Record<string, unknown>;
}

export class UpsertLeadDto {
  @IsString() @MinLength(1) @MaxLength(200) idempotencyKey!: string;
  @IsIn(AUTOMATION_SOURCES) source!: AutomationSource;
  @IsIn(CUSTOMER_CHANNELS) channel!: CustomerChannel;
  @IsOptional() @IsString() @MaxLength(200) customerId?: string;
  @IsOptional() @IsString() @MaxLength(200) leadId?: string;

  @IsOptional() @ValidateNested() @Type(() => CustomerInputDto)
  customer?: CustomerInputDto;

  @IsOptional() @ValidateNested() @Type(() => LeadInputDto)
  lead?: LeadInputDto;

  @IsOptional() @ValidateNested() @Type(() => AutomationContextDto)
  context?: AutomationContextDto;
}
