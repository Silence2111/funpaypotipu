'use client';

import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

/** Темы обращений; показывать через t(). */
export const SUPPORT_CATEGORY: Record<string, string> = {
  order: msg('Заказ'),
  payment: msg('Оплата и баланс'),
  account: msg('Аккаунт и вход'),
  selling: msg('Продажи и лоты'),
  other: msg('Другое'),
};

/** Чей ход: «ждёт ответа» у пользователя — это ход поддержки. */
export function TicketStatusBadge({ status, staffView = false }: { status: string; staffView?: boolean }) {
  const t = useT();
  if (status === 'closed') return <span className="badge">{t('закрыто')}</span>;
  if (status === 'answered')
    return (
      <span className={staffView ? 'badge' : 'badge accent'}>{staffView ? t('ждём пользователя') : t('есть ответ')}</span>
    );
  return <span className={staffView ? 'badge accent' : 'badge'}>{staffView ? t('ждёт ответа') : t('на рассмотрении')}</span>;
}
