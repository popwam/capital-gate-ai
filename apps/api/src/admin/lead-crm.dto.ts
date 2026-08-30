import { LeadIntent, LeadStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export const CONVERSATION_EXPORT_FORMATS = ["md", "json", "xlsx", "csv"] as const;
export type ConversationExportFormat = (typeof CONVERSATION_EXPORT_FORMATS)[number];

export class LeadListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() limit = 20;
  @IsEnum(LeadStatus) @IsOptional() status?: LeadStatus;
  @IsString() @MaxLength(120) @IsOptional() search?: string;
  @IsString() @IsOptional() projectId?: string;
  @IsString() @IsOptional() assignedTo?: string;
  @IsIn(["CONTACT_VALID", "NEEDS_VERIFICATION", "SUSPICIOUS", "ADMIN_CONFIRMED_REAL", "ADMIN_CONFIRMED_FAKE"]) @IsOptional() trustStatus?: string;
  @IsIn(["high", "medium", "low"]) @IsOptional() intentLevel?:
    "high" | "medium" | "low";
  @IsIn(["due", "upcoming", "none"]) @IsOptional() followUp?:
    "due" | "upcoming" | "none";
  @IsDateString() @IsOptional() createdFrom?: string;
  @IsDateString() @IsOptional() createdTo?: string;
  @IsIn([
    "newest",
    "oldest",
    "highest_intent",
    "lowest_intent",
    "last_activity",
    "follow_up",
  ])
  @IsOptional()
  sort = "newest";
}

export class UpdateLeadDto {
  @IsEnum(LeadStatus) @IsOptional() status?: LeadStatus;
  @Transform(({ value }) => (value === "" ? null : value))
  @IsString()
  @IsOptional()
  assignedToAdminId?: string | null;
  @Transform(({ value }) => (value === "" ? null : value))
  @IsDateString()
  @IsOptional()
  followUpAt?: string | null;
}

export class CreateLeadNoteDto {
  @IsString() @MaxLength(2_000) content!: string;
}

export class AdminConversationListQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @IsOptional() page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) @IsOptional() limit = 20;
  @IsString() @MaxLength(120) @IsOptional() search?: string;
  @IsEnum(LeadIntent) @IsOptional() intent?: LeadIntent;
}

export class AdminConversationExportQueryDto {
  @IsString() @MaxLength(120) @IsOptional() search?: string;
  @IsEnum(LeadIntent) @IsOptional() intent?: LeadIntent;
  @IsIn(CONVERSATION_EXPORT_FORMATS) format: ConversationExportFormat = "xlsx";
}

export class AdminConversationModeDto {
  @IsIn(["AI", "HUMAN", "PAUSED"]) mode!: "AI" | "HUMAN" | "PAUSED";
}

export class AdminConversationDeleteDto {
  @IsIn(["DELETE"]) confirmation!: "DELETE";
}

export class TrustAlertFeedbackDto {
  @IsIn(["ADMIN_CONFIRMED_REAL", "ADMIN_CONFIRMED_FAKE", "RESOLVED"]) disposition!: "ADMIN_CONFIRMED_REAL" | "ADMIN_CONFIRMED_FAKE" | "RESOLVED";
  @IsString() @MaxLength(1_000) @IsOptional() note?: string;
}
