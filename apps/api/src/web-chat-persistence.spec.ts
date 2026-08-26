import * as assert from "node:assert/strict";
import { test } from "node:test";
import { WebChatPersistenceService } from "./web-chat-persistence.service";

test("Nadim web presentation persists both messages once and links conversation continuity", async () => {
  const storedMessages = new Map<string, any>();
  let linkedConversationId: string | null = null;
  const prisma: any = {
    conversation: {
      update: async ({ data }: any) => { linkedConversationId = data.nadimConversationId; return {}; },
    },
    message: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const message of data) if (!storedMessages.has(message.id)) { storedMessages.set(message.id, { ...message, createdAt: new Date(0) }); count += 1; }
        return { count };
      },
      findUniqueOrThrow: async ({ where }: any) => storedMessages.get(where.id),
    },
    $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
  };
  const conversations: any = {
    assertOwned: async () => ({ conversation: { id: "web-1", nadimConversationId: linkedConversationId } }),
  };
  const service = new WebChatPersistenceService(prisma, conversations);
  const input = {
    legacyConversationId: "web-1",
    nadimConversationId: "nadim-1",
    deviceToken: "device-token-with-sufficient-length",
    eventId: "event-1",
    userMessage: "3ayz sho2a",
    assistantReply: "mala2etsh match mazboot.",
  };

  const first = await service.persist(input);
  const replay = await service.persist(input);
  assert.equal(linkedConversationId, "nadim-1");
  assert.equal(storedMessages.size, 2);
  assert.equal(first.content, input.assistantReply);
  assert.equal(replay.id, first.id);
});

test("a legacy web shell cannot be rebound to another Nadim conversation", async () => {
  const service = new WebChatPersistenceService({} as any, {
    assertOwned: async () => ({ conversation: { id: "web-1", nadimConversationId: "nadim-1" } }),
  } as any);
  await assert.rejects(() => service.persist({
    legacyConversationId: "web-1",
    nadimConversationId: "nadim-2",
    deviceToken: "device-token-with-sufficient-length",
    eventId: "event-2",
    userMessage: "hello",
    assistantReply: "hello",
  }), (error: any) => error.getStatus() === 409);
});
