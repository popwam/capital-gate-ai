-- Dedicated channel-independent state and turn telemetry for Nadim Brain V2.
CREATE TABLE "NadimConversation" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "channel" TEXT NOT NULL,
  "externalUserId" TEXT,
  "locale" TEXT,
  "state" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NadimConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NadimTurn" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "requestId" TEXT,
  "channel" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "requestHash" TEXT,
  "responsePayload" JSONB,
  "userMessage" TEXT NOT NULL,
  "assistantReply" TEXT NOT NULL,
  "intent" JSONB NOT NULL,
  "plan" JSONB NOT NULL,
  "toolResults" JSONB NOT NULL,
  "proposedActions" JSONB NOT NULL,
  "executedActions" JSONB NOT NULL,
  "modelProvider" TEXT,
  "model" TEXT,
  "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
  "success" BOOLEAN NOT NULL DEFAULT true,
  "latencyMs" INTEGER NOT NULL,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NadimTurn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NadimConversation_customerId_updatedAt_idx" ON "NadimConversation"("customerId", "updatedAt");
CREATE INDEX "NadimConversation_channel_externalUserId_updatedAt_idx" ON "NadimConversation"("channel", "externalUserId", "updatedAt");
CREATE INDEX "NadimTurn_conversationId_createdAt_idx" ON "NadimTurn"("conversationId", "createdAt");
CREATE INDEX "NadimTurn_requestId_idx" ON "NadimTurn"("requestId");
CREATE UNIQUE INDEX "NadimTurn_channel_idempotencyKey_key" ON "NadimTurn"("channel", "idempotencyKey");

ALTER TABLE "NadimConversation" ADD CONSTRAINT "NadimConversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NadimTurn" ADD CONSTRAINT "NadimTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "NadimConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
