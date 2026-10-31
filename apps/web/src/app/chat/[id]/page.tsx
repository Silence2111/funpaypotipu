'use client';

import { useParams } from 'next/navigation';
import { useSession } from '@/lib/session';
import { ChatThread } from '@/components/chat-thread';

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const { user } = useSession();
  // Вход проверяет раскладка мессенджера: сюда без пользователя не попасть.
  if (!user) return null;
  return <ChatThread key={params.id} conversationId={params.id} meId={user.id} />;
}
