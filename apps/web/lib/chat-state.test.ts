import assert from "node:assert/strict";
import test from "node:test";
import { appendUniqueMessage, mergeConversationIndex, shouldLoadConversationHistory } from "./chat-state.ts";

type Message = { id: string; role: "user" | "assistant"; text: string };
type Conversation = { id: string; title: string; messages: Message[] };

test("a locally created conversation skips the stale bootstrap history request once", () => {
  const skip = new Set(["server-1"]);
  assert.equal(shouldLoadConversationHistory("server-1", skip), false);
  assert.equal(shouldLoadConversationHistory("server-1", skip), true);
});

test("title reconciliation cannot erase first-turn user and assistant messages", () => {
  const user: Message = { id: "optimistic-user", role: "user", text: "first question" };
  const assistant: Message = { id: "assistant-1", role: "assistant", text: "answer" };
  let conversations: Conversation[] = [{ id: "server-1", title: "first question", messages: [user] }];
  conversations = appendUniqueMessage(conversations, "server-1", assistant);
  conversations = mergeConversationIndex(
    conversations,
    [{ id: "server-1", title: "generated title", messages: [] }],
    new Set(["server-1"]),
  );
  assert.deepEqual(conversations[0].messages, [user, assistant]);
  assert.equal(conversations[0].title, "generated title");
});

test("replayed complete events update rather than duplicate an assistant message", () => {
  const initial: Conversation[] = [{
    id: "server-1",
    title: "chat",
    messages: [{ id: "assistant-1", role: "assistant", text: "partial" }],
  }];
  const replay: Message = { id: "assistant-1", role: "assistant", text: "complete" };
  const result = appendUniqueMessage(initial, "server-1", replay);
  assert.equal(result[0].messages.length, 1);
  assert.equal(result[0].messages[0].text, "complete");
});

test("a locally created conversation survives an older conversation-index response", () => {
  const local: Conversation = { id: "server-1", title: "new", messages: [{ id: "user-1", role: "user", text: "hello" }] };
  const old: Conversation = { id: "older", title: "older", messages: [] };
  const result = mergeConversationIndex([local], [old], new Set(["server-1"]));
  assert.deepEqual(result.map(conversation => conversation.id), ["server-1", "older"]);
});
