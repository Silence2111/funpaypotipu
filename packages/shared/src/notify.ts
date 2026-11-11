/**
 * Уведомления: что о чём, куда ведёт и в какие каналы уходит.
 *
 * Один источник для колокольчика на сайте, писем, Telegram и пушей: раньше
 * подписи жили отдельно в вебе и в API и расходились при первой правке.
 */

export type NotifyChannel = 'email' | 'telegram' | 'push';

export const NOTIFY_GROUPS = [
  {
    key: 'orders',
    label: 'Заказы',
    hint: 'оплата, выдача, подтверждение, возвраты',
    types: [
      'order_created',
      'order_paid',
      'order_started',
      'service_overdue',
      'order_delivered',
      'order_completed',
      'warranty_started',
      'order_cancelled',
      'order_refunded',
      'listing_out_of_stock',
      'payment_to_balance',
      'deal_check',
    ],
  },
  { key: 'messages', label: 'Сообщения', hint: 'новые сообщения в чатах', types: ['new_message'] },
  { key: 'disputes', label: 'Споры', hint: 'открыт спор, ждём вашего ответа, срок ответа подходит к концу, решение арбитра', types: ['dispute_opened', 'dispute_reply_needed', 'dispute_reply_soon', 'dispute_resolved', 'dispute_appealed'] },
  { key: 'reviews', label: 'Отзывы', hint: 'новый отзыв, ответ продавца, оценка вас как покупателя', types: ['review_received', 'review_reply', 'buyer_review'] },
  { key: 'finance', label: 'Деньги', hint: 'кэшбэк, выплаты и партнёрские начисления', types: ['cashback', 'payout_paid', 'payout_rejected', 'partner_reward', 'deal_payout_waiting', 'payout_delayed', 'payout_overdue'] },
  { key: 'support', label: 'Поддержка', hint: 'ответы на ваши обращения', types: ['support_reply'] },
  {
    key: 'searches',
    label: 'Поиски, избранное и подписки',
    hint: 'новые предложения по сохранённым поискам, снижение цены в избранном, поступление закончившихся лотов, новые лоты и скидки продавцов, на которых вы подписаны',
    types: ['saved_search', 'price_drop', 'back_in_stock', 'seller_new_lots', 'seller_sale'],
  },
  {
    key: 'requests',
    label: 'Запросы покупателей',
    hint: 'покупатель ищет в разделе, где вы продаёте; продавец ответил лотом на ваш запрос',
    types: ['buy_request', 'buy_request_offer'],
  },
  {
    key: 'security',
    label: 'Безопасность',
    hint: 'вход с нового устройства, смена пароля, почты и входа с кодом, восстановление доступа — письмом всегда',
    types: [
      'new_login',
      'password_changed',
      'email_changed',
      'two_factor_enabled',
      'two_factor_disabled',
      'recovery_requested',
      'recovery_restored',
      'recovery_rejected',
      'login_method_needed',
      'account_deleted',
      'phone_changed',
    ],
  },
  {
    key: 'moderation',
    label: 'Решения модерации',
    hint: 'жалобы, блокировки, проверка документов — письмом всегда',
    types: [
      'report_handled',
      'listing_blocked',
      'listing_unblocked',
      'listing_approved',
      'section_closed',
      'section_opened',
      'account_status',
      'chat_muted',
      'chat_message_removed',
      'balance_held',
      'balance_released',
      'appeal_decided',
      'appeal_overdue',
      'kyc_approved',
      'kyc_rejected',
    ],
  },
] as const;

export type NotifyGroup = (typeof NOTIFY_GROUPS)[number]['key'];
export type NotifyPrefs = Partial<Record<NotifyChannel, Partial<Record<NotifyGroup, boolean>>>>;

/**
 * По умолчанию письмом — то, где решаются деньги; в Telegram и пушами — всё:
 * их включают ради быстрых уведомлений о заказах и сообщениях.
 */
export const DEFAULT_NOTIFY: Record<NotifyChannel, Record<NotifyGroup, boolean>> = {
  email: { orders: true, messages: false, disputes: true, reviews: false, finance: true, support: true, searches: false, requests: false, security: true, moderation: true },
  telegram: { orders: true, messages: true, disputes: true, reviews: true, finance: true, support: true, searches: true, requests: true, security: true, moderation: true },
  push: { orders: true, messages: true, disputes: true, reviews: true, finance: true, support: true, searches: true, requests: true, security: true, moderation: true },
};

/**
 * Решения модерации, вход с нового устройства и смена пароля доходят письмом
 * всегда: человек должен знать, почему его ограничили и что в аккаунте
 * хозяйничает кто-то ещё.
 */
export const LOCKED_NOTIFY: Partial<Record<NotifyChannel, NotifyGroup[]>> = { email: ['moderation', 'security'] };

export const NOTIFY_LABELS: Record<string, string> = {
  order_created: 'Новый заказ по вашему лоту',
  order_paid: 'Заказ оплачен — выдайте товар',
  order_started: 'Продавец взял заказ в работу',
  service_overdue: 'Срок выполнения заказа вышел',
  order_delivered: 'Товар выдан — подтвердите получение',
  order_completed: 'Сделка завершена, деньги зачислены',
  warranty_started: 'Покупатель подтвердил получение — деньги придут после гарантии',
  order_cancelled: 'Заказ отменён',
  order_refunded: 'Возврат по заказу',
  payment_to_balance: 'Повторная оплата заказа зачислена на баланс',
  deal_check: 'Подтвердите сделку: другая сторона восстанавливает доступ',
  listing_out_of_stock: 'Склад лота опустел — заказ возвращён',
  review_received: 'Новый отзыв',
  review_reply: 'Продавец ответил на ваш отзыв',
  buyer_review: 'Продавец оценил вас как покупателя',
  new_login: 'Вход в аккаунт с нового устройства',
  password_changed: 'Пароль изменён',
  email_changed: 'Почта аккаунта изменена',
  two_factor_enabled: 'Вход с кодом из приложения включён',
  two_factor_disabled: 'Вход с кодом из приложения выключен',
  recovery_requested: 'Заявка на восстановление доступа',
  recovery_restored: 'Доступ к аккаунту восстановлен',
  recovery_rejected: 'Заявка на восстановление отклонена',
  login_method_needed: 'Вход через Telegram отключён — добавьте почту и пароль',
  account_deleted: 'Аккаунт удалён — данные уничтожим через 30 дней, до этого его можно восстановить входом',
  phone_changed: 'Номер телефона для входа изменён',
  cashback: 'Кэшбэк за покупку зачислен на баланс',
  partner_reward: 'Партнёрское вознаграждение зачислено на баланс',
  new_message: 'Новое сообщение',
  dispute_opened: 'Спор по сделке',
  dispute_reply_needed: 'Ждём вашего ответа в споре',
  // Часы — DISPUTE_REMIND_HOURS в dispute.ts.
  dispute_reply_soon: 'Меньше 3 часов на ответ в споре',
  dispute_resolved: 'Спор разрешён',
  report_handled: 'Ваша жалоба рассмотрена',
  listing_blocked: 'Лот заблокирован модератором',
  chat_muted: 'Модератор запретил вам писать в чаты игр',
  listing_unblocked: 'Блокировка лота снята',
  listing_approved: 'Лот прошёл проверку и вернулся в продажу',
  section_closed: 'Раздел закрыт для продажи — ваши лоты сняты с витрины',
  section_opened: 'Раздел снова открыт — ваши лоты вернулись в продажу',
  account_status: 'Статус аккаунта изменён',
  dispute_appealed: 'Решение по спору обжаловано — пересмотрит другой арбитр',
  chat_message_removed: 'Модератор удалил ваше сообщение в чате игры',
  balance_held: 'Модератор удержал часть баланса',
  balance_released: 'Удержание с баланса снято',
  appeal_decided: 'Решение по вашему обжалованию',
  appeal_overdue: 'Обжалование ждёт ответа дольше срока',
  payout_delayed: 'Проверка вывода затянулась — заявку передали старшему сотруднику',
  payout_overdue: 'Заявка на вывод ждёт решения дольше срока',
  kyc_approved: 'Документы проверены — вывод без ограничения суммы',
  kyc_rejected: 'Документы не приняты — посмотрите причину',
  payout_paid: 'Выплата отправлена',
  payout_rejected: 'Выплата отклонена',
  deal_payout_waiting: 'Выплата по сделке ждёт карту или ЮMoney — укажите их в «Кошельке»',
  support_reply: 'Поддержка ответила на обращение',
  saved_search: 'Новые предложения по сохранённому поиску',
  price_drop: 'Лот из избранного подешевел',
  back_in_stock: 'Лот снова в продаже',
  seller_new_lots: 'Новые лоты у продавца из подписок',
  seller_sale: 'Скидка у продавца из подписок',
  buy_request: 'Покупатель ищет в вашем разделе',
  buy_request_offer: 'Продавец ответил лотом на ваш запрос',
};

export function notifyGroupOf(type: string): NotifyGroup | null {
  return NOTIFY_GROUPS.find((g) => (g.types as readonly string[]).includes(type))?.key ?? null;
}

/** Настройки пользователя поверх значений по умолчанию. */
export function notifyPrefs(saved: NotifyPrefs | null | undefined): Record<NotifyChannel, Record<NotifyGroup, boolean>> {
  return {
    email: { ...DEFAULT_NOTIFY.email, ...(saved?.email ?? {}) },
    telegram: { ...DEFAULT_NOTIFY.telegram, ...(saved?.telegram ?? {}) },
    push: { ...DEFAULT_NOTIFY.push, ...(saved?.push ?? {}) },
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
  // Один новый лот — на него, несколько — в раздел с условиями поиска.
  if (type === 'saved_search') {
    if (id('listingId')) return `/lot/${id('listingId')}`;
    const path = id('path');
    return path?.startsWith('/igra/') ? path : '/cabinet/searches';
  }
  // Запрос покупателя — продавцу в кабинет с этим запросом сверху; ответ
  // продавца покупателю — на лот (ниже, общим правилом listingId).
  if (type === 'buy_request') {
    return id('requestId') ? `/cabinet/requests?r=${encodeURIComponent(id('requestId')!)}` : '/cabinet/requests';
  }
  // Подписка: один лот — на него, несколько — в профиль продавца.
  if (type === 'seller_new_lots' || type === 'seller_sale') {
    if (id('listingId')) return `/lot/${id('listingId')}`;
    return id('sellerId') ? `/prodavec/${id('sellerId')}` : '/cabinet/following';
  }
  if (type.startsWith('kyc_')) return '/cabinet/verification';
  // Вход с нового устройства — к этому сеансу: «Это не я» завершит именно его.
  if (type === 'new_login') {
    const session = id('session');
    return session ? `/cabinet/security?session=${encodeURIComponent(session)}` : '/cabinet/security';
  }
  if (
    type === 'login_method_needed' ||
    type === 'password_changed' ||
    type === 'email_changed' ||
    type === 'phone_changed' ||
    type.startsWith('two_factor_') ||
    type.startsWith('recovery_')
  ) {
    return '/cabinet/security';
  }
  // Просьба подтвердить сделку — в кабинет, где на неё отвечают, а не в сам заказ.
  if (type === 'deal_check') return '/cabinet/deal-checks';
  // Решения модерации и обжалования (часть 134) — в кабинет «Решения модерации»;
  // сотруднику — в очередь обжалований и вывода.
  if (type === 'appeal_overdue') return '/admin?tab=appeals';
  if (type === 'payout_overdue') return '/admin?tab=payouts';
  if (id('decisionId') || type === 'appeal_decided') return '/cabinet/decisions';
  if (type === 'balance_released' || type === 'payout_delayed') return '/cabinet/wallet';
  // Выплата по «Безопасной сделке» ждёт реквизиты — в кошелёк, где их указывают.
  if (type === 'deal_payout_waiting') return '/cabinet/wallet';
  if (type === 'new_message' && id('conversationId')) return `/chat/${id('conversationId')}`;
  if (id('orderId')) return `/orders/${id('orderId')}`;
  if (id('listingId')) return type === 'listing_blocked' ? '/cabinet/lots' : `/lot/${id('listingId')}`;
  // Раздел закрыли или открыли — в «Мои лоты»: там видно, какие лоты сняты.
  if (type === 'section_closed' || type === 'section_opened') return '/cabinet/lots';
  // Деньги — в кошелёк: там баланс, заявки на вывод и выписка.
  if (type === 'partner_reward') return '/cabinet/partner';
  if (type.startsWith('payout') || type === 'cashback') return '/cabinet/wallet';
  return '/cabinet';
}
