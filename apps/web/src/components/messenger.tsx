'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/lib/session';
import { ChatSocketProvider } from '@/lib/chat';
import { ChatList } from './chat-list';
import { useT } from '@/lib/i18n/client';

/**
 * Мессенджер в две колонки, как у FunPay: слева диалоги, справа открытый.
 * Список живёт в раскладке и не перезагружается при переходе между
 * диалогами. На телефоне — список, затем диалог во весь экран.
 */
export function Messenger({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { ready, user } = useSession();
  const pathname = usePathname();
  const activeId = pathname.startsWith('/chat/') ? pathname.split('/')[2] : undefined;

  if (!ready) return <div className="container" style={{ padding: 48 }} aria-busy="true" />;
  if (!user) {
    return (
      <div className="container" style={{ paddingTop: 48 }}>
        <h1 className="h2">{t('Сообщения')}</h1>
        <p className="muted">
          {t('Войдите, чтобы открыть переписку с продавцами и покупателями.')}
        </p>
        <Link href={`/login?next=${encodeURIComponent(pathname)}`} className="btn">
          {t('Войти')}
        </Link>
      </div>
    );
  }

  return (
    <ChatSocketProvider>
      <div className="container messenger-wrap">
        <div className="messenger" data-open={activeId ? 'true' : undefined}>
          <aside className="messenger-list">
            <ChatList activeId={activeId} meId={user.id} />
          </aside>
          <section className="messenger-pane">{children}</section>
        </div>
      </div>
    </ChatSocketProvider>
  );
}
