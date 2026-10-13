'use client';

export const SUPPORT_CATEGORY: Record<string, string> = {
  order: 'Заказ',
  payment: 'Оплата и баланс',
  account: 'Аккаунт и вход',
  selling: 'Продажи и лоты',
  other: 'Другое',
};

/** Чей ход: «ждёт ответа» у пользователя — это ход поддержки. */
export function TicketStatusBadge({ status, staffView = false }: { status: string; staffView?: boolean }) {
  if (status === 'closed') return <span className="badge">закрыто</span>;
  if (status === 'answered') return <span className={staffView ? 'badge' : 'badge accent'}>{staffView ? 'ждём пользователя' : 'есть ответ'}</span>;
  return <span className={staffView ? 'badge accent' : 'badge'}>{staffView ? 'ждёт ответа' : 'на рассмотрении'}</span>;
}
