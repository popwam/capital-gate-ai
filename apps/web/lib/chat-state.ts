export type ChatMessageState = {
  id: string;
  role: "user" | "assistant";
};

export type ChatConversationState<TMessage extends ChatMessageState = ChatMessageState> = {
  id: string;
  messages: TMessage[];
};

export function appendUniqueMessage<
  TMessage extends ChatMessageState,
  TConversation extends ChatConversationState<TMessage>,
>(conversations: TConversation[], conversationId: string, message: TMessage): TConversation[] {
  return conversations.map(conversation => {
    if (conversation.id !== conversationId) return conversation;
    const existing = conversation.messages.findIndex(item => item.id === message.id);
    const messages = existing === -1
      ? [...conversation.messages, message]
      : conversation.messages.map(item => item.id === message.id ? message : item);
    return { ...conversation, messages };
  });
}

export function shouldLoadConversationHistory(activeId: string, skipOnce: Set<string>): boolean {
  if (activeId === "fresh") return false;
  if (skipOnce.delete(activeId)) return false;
  return true;
}

export function mergeConversationIndex<TConversation extends ChatConversationState>(
  current: TConversation[],
  incoming: TConversation[],
  locallyCreatedIds: ReadonlySet<string>,
): TConversation[] {
  const currentById = new Map(current.map(conversation => [conversation.id, conversation]));
  const incomingIds = new Set(incoming.map(conversation => conversation.id));
  const localOnly = current.filter(conversation => locallyCreatedIds.has(conversation.id) && !incomingIds.has(conversation.id));
  const reconciled = incoming.map(conversation => {
    const existing = currentById.get(conversation.id);
    return existing?.messages.length ? { ...conversation, messages: existing.messages } : conversation;
  });
  return [...localOnly, ...reconciled];
}
