CREATE TYPE "NadimConversationMode" AS ENUM ('AI', 'HUMAN', 'PAUSED');

ALTER TABLE "NadimConversation"
  ADD COLUMN "mode" "NadimConversationMode" NOT NULL DEFAULT 'AI',
  ADD COLUMN "summary" JSONB,
  ADD COLUMN "customerContext" JSONB,
  ADD COLUMN "pendingDeletion" JSONB,
  ADD COLUMN "modeChangedAt" TIMESTAMP(3),
  ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "NadimConversation_mode_updatedAt_idx" ON "NadimConversation"("mode", "updatedAt");
CREATE INDEX "NadimConversation_deletedAt_idx" ON "NadimConversation"("deletedAt");

CREATE TABLE "NadimDeletionReceipt" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "responsePayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NadimDeletionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NadimDeletionReceipt_channel_idempotencyKey_key"
  ON "NadimDeletionReceipt"("channel", "idempotencyKey");
CREATE INDEX "NadimDeletionReceipt_conversationId_createdAt_idx"
  ON "NadimDeletionReceipt"("conversationId", "createdAt");
