CREATE TYPE "PropertyRequirementStatus" AS ENUM ('OPEN', 'NEEDS_MATCH', 'HUMAN_REVIEW', 'MATCHED', 'CLOSED');
CREATE TYPE "FollowUpTaskStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'CANCELLED');
CREATE TYPE "ConversationParticipantRole" AS ENUM ('OWNER', 'MEMBER');
CREATE TYPE "ConversationParticipantStatus" AS ENUM ('ACTIVE', 'LEFT', 'REVOKED');
CREATE TYPE "ConversationTokenType" AS ENUM ('WEB_SHARE', 'WHATSAPP_HANDOFF', 'WHATSAPP_JOIN');
CREATE TYPE "ConversationSharePermission" AS ENUM ('VIEW_AND_JOIN');

ALTER TABLE "Customer" ADD COLUMN "timezone" TEXT;
DROP INDEX IF EXISTS "Conversation_nadimConversationId_key";
CREATE INDEX "Conversation_nadimConversationId_idx" ON "Conversation"("nadimConversationId");
ALTER TABLE "NadimConversation"
  ADD COLUMN "timezone" TEXT,
  ADD COLUMN "humanModeSince" TIMESTAMP(3),
  ADD COLUMN "lastHumanMessageAt" TIMESTAMP(3),
  ADD COLUMN "activeRequirementId" TEXT;

CREATE TABLE "PropertyRequirement" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "conversationId" TEXT,
  "title" TEXT NOT NULL,
  "purpose" TEXT,
  "propertyType" TEXT,
  "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "preferredDevelopers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "preferredProjects" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "bedrooms" INTEGER,
  "bathrooms" INTEGER,
  "areaMin" DECIMAL(12,2),
  "areaMax" DECIMAL(12,2),
  "budgetMin" DECIMAL(16,2),
  "budgetMax" DECIMAL(16,2),
  "currency" TEXT,
  "paymentPreference" TEXT,
  "deliveryPreference" TEXT,
  "notes" TEXT,
  "status" "PropertyRequirementStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PropertyRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpTask" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "propertyRequirementId" TEXT,
  "channel" TEXT NOT NULL,
  "outboundAddress" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "timezone" TEXT NOT NULL,
  "status" "FollowUpTaskStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "messageIntent" JSONB NOT NULL,
  "renderedMessage" TEXT,
  "safeDuringHuman" BOOLEAN NOT NULL DEFAULT false,
  "claimedAt" TIMESTAMP(3),
  "claimedBy" TEXT,
  "sentAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  "provider" TEXT,
  "providerMessageId" TEXT,
  "lastError" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FollowUpTask_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationParticipant" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "customerId" TEXT,
  "channel" TEXT NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "role" "ConversationParticipantRole" NOT NULL DEFAULT 'MEMBER',
  "status" "ConversationParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
  "displayMetadata" JSONB,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationShareToken" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "createdByParticipantId" TEXT,
  "tokenHash" TEXT NOT NULL,
  "type" "ConversationTokenType" NOT NULL,
  "permission" "ConversationSharePermission" NOT NULL DEFAULT 'VIEW_AND_JOIN',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationShareToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConversationParticipant_conversationId_channel_externalUserId_key" ON "ConversationParticipant"("conversationId", "channel", "externalUserId");
CREATE UNIQUE INDEX "ConversationShareToken_tokenHash_key" ON "ConversationShareToken"("tokenHash");
CREATE INDEX "PropertyRequirement_customerId_status_updatedAt_idx" ON "PropertyRequirement"("customerId", "status", "updatedAt");
CREATE INDEX "PropertyRequirement_conversationId_status_idx" ON "PropertyRequirement"("conversationId", "status");
CREATE INDEX "FollowUpTask_status_dueAt_idx" ON "FollowUpTask"("status", "dueAt");
CREATE INDEX "FollowUpTask_conversationId_status_idx" ON "FollowUpTask"("conversationId", "status");
CREATE INDEX "FollowUpTask_claimedBy_claimedAt_idx" ON "FollowUpTask"("claimedBy", "claimedAt");
CREATE INDEX "ConversationParticipant_channel_externalUserId_status_idx" ON "ConversationParticipant"("channel", "externalUserId", "status");
CREATE INDEX "ConversationParticipant_customerId_status_idx" ON "ConversationParticipant"("customerId", "status");
CREATE INDEX "ConversationShareToken_conversationId_type_expiresAt_idx" ON "ConversationShareToken"("conversationId", "type", "expiresAt");
CREATE INDEX "ConversationShareToken_expiresAt_revokedAt_idx" ON "ConversationShareToken"("expiresAt", "revokedAt");
CREATE INDEX "NadimConversation_mode_lastHumanMessageAt_humanModeSince_idx" ON "NadimConversation"("mode", "lastHumanMessageAt", "humanModeSince");
CREATE INDEX "NadimConversation_activeRequirementId_idx" ON "NadimConversation"("activeRequirementId");

ALTER TABLE "PropertyRequirement" ADD CONSTRAINT "PropertyRequirement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PropertyRequirement" ADD CONSTRAINT "PropertyRequirement_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NadimConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NadimConversation" ADD CONSTRAINT "NadimConversation_activeRequirementId_fkey" FOREIGN KEY ("activeRequirementId") REFERENCES "PropertyRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NadimConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpTask" ADD CONSTRAINT "FollowUpTask_propertyRequirementId_fkey" FOREIGN KEY ("propertyRequirementId") REFERENCES "PropertyRequirement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NadimConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationShareToken" ADD CONSTRAINT "ConversationShareToken_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NadimConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationShareToken" ADD CONSTRAINT "ConversationShareToken_createdByParticipantId_fkey" FOREIGN KEY ("createdByParticipantId") REFERENCES "ConversationParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
