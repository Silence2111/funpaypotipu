/**
 * Уведомления: что о чём, куда ведёт и в какие каналы уходит.
 *
 * Один источник для колокольчика на сайте, писем и Telegram: раньше подписи
 * жили отдельно в вебе и в API и расходились при первой правке.
 */

export type NotifyChannel = 'email' | 'telegram';

export const NOTIFY_GROUPS = [
  {
    key: 'orders',
    label: 'Заказы',
    hint: 'оплата, выдача, подтверждение, возвраты',
    types: [
      'order_created',
      'order_paid',
      'order_delivered',
      'order_completed',
      'order_cancelled',
      'order_refunded',
      'listing_out_of_stock',
      'payment_to_balance',
    ],
  },
  { key: 'messages', label: 'Сообщения', hint: 'новые сообщения в чатах', types: ['new_message'] },
  { key: 'disputes', label: 'Споры', hint: 'открыт спор, решение арбитра', types: ['dispute_opened', 'dispute_resolved'] },
  { key: 'reviews', label: 'Отзывы', hint: 'новый отзыв, ответ продавца', types: ['review_received', 'review_reply'] },
  { key: 'finance', label: 'Деньги', hint: 'кэшбэк и выплаты', types: ['cashback', 'payout_paid', 'payout_rejected'] },
  { key: 'support', label: 'Поддержка', hint: 'ответы на ваши обращения', types: ['support_reply'] },
  {
    key: 'moderation',
    label: 'Решения модерации',
    hint: 'жалобы, блокировки — письмом всегда',
    types: ['report_handled', 'listing_blocked', 'listing_unblocked', 'account_status'],
  },
] as const;

export type NotifyGroup = (typeof NOTIFY_GROUPS)[number]['key'];
export type NotifyPrefs = Partial<Record<NotifyChannel, Partial<Record<NotifyGroup, boolean>>>>;

/**
 * По умолчанию письмом — то, где решаются деньги; в Telegram — всё: его
 * подключают ради быстрых уведомлений о заказах и сообщениях.
 */
export const DEFAULT_NOTIFY: Record<NotifyChannel, Record<NotifyGroup, boolean>> = {
  email: { orders: true, messages: false, disputes: true, reviews: false, finance: true, support: true, moderation: true },
  telegram: { orders: true, messages: true, disputes: true, reviews: true, finance: true, support: true, moderation: true },
};

/** Решения модерации доходят письмом всегда: человек должен знать, почему его ограничили. */
export const LOCKED_NOTIFY: Partial<Record<NotifyChannel, NotifyGroup[]>> = { email: ['moderation'] };

export const NOTIFY_LABELS: Record<string, string> = {
  order_created: 'Новый заказ по вашему лоту',
  order_paid: 'Заказ оплачен — выдайте товар',
  order_delivered: 'Товар выдан — подтвердите получение',
  order_completed: 'Сделка завершена, деньги зачислены',
  order_cancelled: 'Заказ отменён',
  order_refunded: 'Возврат по заказу',
  payment_to_balance: 'Повторная оплата заказа зачислена на баланс',
  listing_out_of_stock: 'Закончились ключи по лоту — заказ возвращён',
  review_received: 'Новый отзыв',
  review_reply: 'Продавец ответил на ваш отзыв',
  cashback: 'Кэшбэк за покупку зачислен на баланс',
  new_message: 'Новое сообщение',
  dispute_opened: 'Спор по сделке',
  dispute_resolved: 'Спор разрешён',
  report_handled: 'Ваша жалоба рассмотрена',
  listing_blocked: 'Лот заблокирован модератором',
  listing_unblocked: 'Блокировка лота снята',
  account_status: 'Статус аккаунта изменён',
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Выплата отклонена',
  support_reply: 'Поддержка ответила на обращение',
};

export function notifyGroupOf(type: string): NotifyGroup | null {
  return NOTIFY_GROUPS.find((g) => (g.types as readonly string[]).includes(type))?.key ?? null;
}

/** Настройки пользователя поверх значений по умолчанию. */
export function notifyPrefs(saved: NotifyPrefs | null | undefined): Record<NotifyChannel, Record<NotifyGroup, boolean>> {
  return {
    email: { ...DEFAULT_NOTIFY.email, ...(saved?.email ?? {}) },
    telegram: { ...DEFAULT_NOTIFY.telegram, ...(saved?.telegram ?? {}) },
  };
}

/** Уходит ли уведомление этого типа в канал. Неизвестный тип — только на сайт. */
export function wantsNotify(saved: NotifyPrefs | null | undefined, channel: NotifyChannel, type: string): boolean {
  const group = notifyGroupOf(type);
  if (!group) return false;
  if (LOCKED_NOTIFY[channel]?.includes(group)) return true;
  return notifyPrefs(saved)[channel][group];
}

/** Куда ведёт уведомление: заказ, чат, спор, лот — или кабинет. */
export function notifyLink(type: string, payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};
  const id = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  if (id('disputeId')) return `/disputes/${id('disputeId')}`;
  if (id('ticketId')) return `/cabinet/support/${id('ticketId')}`;
  if (type === 'new_message' && id('conversationId')) return `/chat/${id('conversationId')}`;
  if (id('orderId')) return `/orders/${id('orderId')}`;
  if (id('listingId')) return type === 'listing_blocked' ? '/cabinet/lots' : `/lot/${id('listingId')}`;
  if (type.startsWith('payout') || type === 'cashback') return '/cabinet';
  return '/cabinet';
}
