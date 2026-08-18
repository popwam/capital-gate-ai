-- Cg Ai customer trust, handoff preferences, and admin-review alerts.
ALTER TABLE "Lead"
  ADD COLUMN IF NOT EXISTS "trustStatus" TEXT NOT NULL DEFAULT 'CONTACT_VALID',
  ADD COLUMN IF NOT EXISTS "trustScore" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS "trustReasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "preferredContactChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "preferredConfirmationChannel" TEXT,
  ADD COLUMN IF NOT EXISTS "preferredVisitDayPart" TEXT,
  ADD COLUMN IF NOT EXISTS "preferredVisitTiming" TEXT,
  ADD COLUMN IF NOT EXISTS "contactValidatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Lead_trustStatus_createdAt_idx"
  ON "Lead"("trustStatus", "createdAt");

CREATE TABLE IF NOT EXISTS "CustomerTrustAlert" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "leadId" TEXT,
  "riskLevel" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "candidateName" TEXT,
  "candidatePhone" TEXT,
  "messagePreview" TEXT,
  "payload" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedAt" TIMESTAMP(3),
  "resolvedByAdminId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTrustAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerTrustAlert_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CustomerTrustAlert_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "CustomerTrustAlert_resolvedByAdminId_fkey" FOREIGN KEY ("resolvedByAdminId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CustomerTrustAlert_status_createdAt_idx"
  ON "CustomerTrustAlert"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerTrustAlert_conversationId_status_idx"
  ON "CustomerTrustAlert"("conversationId", "status");
CREATE INDEX IF NOT EXISTS "CustomerTrustAlert_leadId_idx"
  ON "CustomerTrustAlert"("leadId");
CREATE INDEX IF NOT EXISTS "CustomerTrustAlert_candidatePhone_idx"
  ON "CustomerTrustAlert"("candidatePhone");

ALTER TABLE "Lead"
  ADD CONSTRAINT "Lead_trustScore_check" CHECK ("trustScore" >= 0 AND "trustScore" <= 100),
  ADD CONSTRAINT "Lead_preferredContactChannel_check" CHECK ("preferredContactChannel" IS NULL OR "preferredContactChannel" IN ('CALL','WHATSAPP','SMS','EMAIL')),
  ADD CONSTRAINT "Lead_preferredConfirmationChannel_check" CHECK ("preferredConfirmationChannel" IS NULL OR "preferredConfirmationChannel" IN ('CALL','WHATSAPP','SMS','EMAIL')),
  ADD CONSTRAINT "Lead_preferredVisitDayPart_check" CHECK ("preferredVisitDayPart" IS NULL OR "preferredVisitDayPart" IN ('MORNING','AFTERNOON','EVENING')),
  ADD CONSTRAINT "Lead_preferredVisitTiming_check" CHECK ("preferredVisitTiming" IS NULL OR "preferredVisitTiming" IN ('MIDWEEK','WEEKEND','WEEKDAY'));

ALTER TABLE "CustomerTrustAlert"
  ADD CONSTRAINT "CustomerTrustAlert_score_check" CHECK ("score" >= 0 AND "score" <= 100),
  ADD CONSTRAINT "CustomerTrustAlert_riskLevel_check" CHECK ("riskLevel" IN ('NEEDS_VERIFICATION','SUSPICIOUS')),
  ADD CONSTRAINT "CustomerTrustAlert_status_check" CHECK ("status" IN ('OPEN','AUTO_RESOLVED_AFTER_VALID_CONTACT','ADMIN_CONFIRMED_REAL','ADMIN_CONFIRMED_FAKE','RESOLVED'));
