-- Add canonical omnichannel customers and deterministic machine-action execution records.
CREATE TABLE "Customer" (
  "id" TEXT NOT NULL,
  "name" TEXT,
  "normalizedPhone" TEXT,
  "normalizedEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerChannelIdentity" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerChannelIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AutomationActionExecution" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "requestPayload" JSONB NOT NULL,
  "responsePayload" JSONB,
  "status" TEXT NOT NULL,
  "errorCode" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "AutomationActionExecution_pkey" PRIMARY KEY ("id")
);

-- Preserve every historical web lead while allowing non-web channel leads.
ALTER TABLE "Lead" DROP CONSTRAINT "Lead_conversationId_fkey";
ALTER TABLE "Lead"
  ALTER COLUMN "conversationId" DROP NOT NULL,
  ALTER COLUMN "name" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "customerId" TEXT;

CREATE UNIQUE INDEX "Customer_normalizedPhone_key" ON "Customer"("normalizedPhone");
CREATE UNIQUE INDEX "Customer_normalizedEmail_key" ON "Customer"("normalizedEmail");
CREATE INDEX "Customer_createdAt_idx" ON "Customer"("createdAt");
CREATE UNIQUE INDEX "CustomerChannelIdentity_channel_externalId_key" ON "CustomerChannelIdentity"("channel", "externalId");
CREATE INDEX "CustomerChannelIdentity_customerId_channel_idx" ON "CustomerChannelIdentity"("customerId", "channel");
CREATE UNIQUE INDEX "AutomationActionExecution_idempotencyKey_key" ON "AutomationActionExecution"("idempotencyKey");
CREATE INDEX "AutomationActionExecution_status_createdAt_idx" ON "AutomationActionExecution"("status", "createdAt");
CREATE INDEX "AutomationActionExecution_entityType_entityId_idx" ON "AutomationActionExecution"("entityType", "entityId");
CREATE INDEX "Lead_customerId_status_updatedAt_idx" ON "Lead"("customerId", "status", "updatedAt");
CREATE INDEX "Lead_phone_status_idx" ON "Lead"("phone", "status");

ALTER TABLE "CustomerChannelIdentity" ADD CONSTRAINT "CustomerChannelIdentity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
