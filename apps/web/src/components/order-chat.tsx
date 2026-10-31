'use client';

import { ChatThread } from './chat-thread';

/** Чат на странице заказа — тот же диалог, что в «Сообщениях», только без шапки. */
export function OrderChat({ conversationId, meId }: { conversationId: string; meId: string }) {
  return <ChatThread conversationId={conversationId} meId={meId} embedded />;
}
