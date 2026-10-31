import type { Metadata } from 'next';
import { Messenger } from '@/components/messenger';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Сообщения'), robots: { index: false } };
}

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <Messenger>{children}</Messenger>;
}
