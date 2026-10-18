import type { Metadata } from 'next';
import { Messenger } from '@/components/messenger';

export const metadata: Metadata = { title: 'Сообщения', robots: { index: false } };

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <Messenger>{children}</Messenger>;
}
