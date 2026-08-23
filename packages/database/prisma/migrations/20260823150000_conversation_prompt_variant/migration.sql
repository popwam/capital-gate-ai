-- Persist a stable prompt experiment assignment for each conversation.
ALTER TABLE "Conversation"
  ADD COLUMN IF NOT EXISTS "promptVariant" TEXT NOT NULL DEFAULT 'control';
