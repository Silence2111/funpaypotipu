import { MessagesSquare } from 'lucide-react';
import { getT } from '@/lib/i18n/server';

/** Без открытого диалога правая колонка подсказывает, что делать. */
export default async function ChatIndexPage() {
  const t = await getT();
  return (
    <div className="messenger-empty">
      <MessagesSquare size={32} strokeWidth={1.75} aria-hidden />
      <p className="muted">{t('Выберите диалог слева. Написать продавцу можно со страницы любого лота.')}</p>
    </div>
  );
}
