-- Keep the existing customer conversation shell while Nadim V2 owns reasoning and state.
ALTER TABLE "Conversation"
ADD COLUMN "nadimConversationId" TEXT;

CREATE UNIQUE INDEX "Conversation_nadimConversationId_key"
ON "Conversation"("nadimConversationId");

ALTER TABLE "Conversation"
ADD CONSTRAINT "Conversation_nadimConversationId_fkey"
FOREIGN KEY ("nadimConversationId") REFERENCES "NadimConversation"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
