import { WITHDRAWAL_METHODS } from './withdrawal';

/**
 * Удаление аккаунта и отзыв согласия (часть 124). Норма — ч. 5 ст. 21
 * 152-ФЗ (действующая редакция, pravo.gov.ru): после отзыва согласия
 * оператор прекращает обработку и уничтожает данные в срок до 30 дней,
 * кроме тех, что он вправе обрабатывать без согласия (ст. 6 ч. 1: п. 5 —
 * исполнение договора, п. 7 — законные интересы, п. 2 — требования закона,
 * например бухучёт). Поэтому сделки, движение денег и переписка по
 * сделкам остаются, а почта, имя, вход и реквизиты — уничтожаются.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Сколько дней удалённый аккаунт можно восстановить; потом данные уничтожаются. */
export const DELETION_GRACE_DAYS = 30;
/** Через столько дней после отзыва согласия уничтожаются данные, что были только по согласию. */
export const CONSENT_ERASE_DAYS = 30;

/** Код ошибки входа: аккаунт удалён, но ещё не стёрт — можно восстановить. */
export const ACCOUNT_DELETED = 'account_deleted';
/** Код ошибки удаления: открытые сделки, споры, деньги — сначала довести. */
export const DELETION_BLOCKED = 'deletion_blocked';

/** Что мешает удалить аккаунт: всё это надо довести, иначе пострадает другая сторона или деньги. */
export interface DeletionBlockers {
  /** Сделки в работе: оплачены, выданы, в споре. */
  orders: number;
  /** Открытые споры. */
  disputes: number;
  /** Деньги на балансе, копейки строкой: мешают, если их можно вывести. */
  balance: string;
  /** Заявки на вывод, которые ещё не выплачены. */
  payouts: number;
  /** Сотрудник площадки: роль сначала снимает администратор. */
  staff: boolean;
}

/**
 * С какой суммы деньги на балансе мешают удалению — с самого малого
 * вывода (300 ₽). Остаток меньше вывести нельзя: он сгорает, но только
 * если человек это подтвердил (`forfeit`). Иначе покупатель с кэшбэком в
 * 20 ₽ не смог бы удалить аккаунт никогда.
 */
export const DELETION_BALANCE_BLOCKS: bigint = WITHDRAWAL_METHODS.reduce(
  (min, m) => (m.minAmount < min ? m.minAmount : min),
  WITHDRAWAL_METHODS[0]!.minAmount,
);

export function hasBlockers(b: DeletionBlockers): boolean {
  return b.orders > 0 || b.disputes > 0 || BigInt(b.balance) >= DELETION_BALANCE_BLOCKS || b.payouts > 0 || b.staff;
}

/** Остаток, который сгорит при удалении: есть, но меньше вывода. */
export function forfeitBalance(b: DeletionBlockers): bigint {
  const v = BigInt(b.balance);
  return v > 0n && v < DELETION_BALANCE_BLOCKS ? v : 0n;
}

/** Когда данные удалённого аккаунта будут уничтожены. */
export function eraseAt(deletedAt: Date | string, days = DELETION_GRACE_DAYS): Date {
  return new Date(new Date(deletedAt).getTime() + days * 24 * 3600_000);
}

/**
 * Группы уведомлений, которые после отзыва согласия не отправляются:
 * подборки и предложения — не исполнение сделки. Заказы, сообщения, споры,
 * деньги, безопасность и решения модерации — по договору, их шлём дальше.
 */
export const CONSENT_ONLY_NOTIFY_GROUPS = ['searches', 'requests'] as const;

/** Ник удалённого: виден в старых сделках и отзывах вместо прежнего. */
export function erasedUsername(userId: string): string {
  return `deleted_${userId.replace(/-/g, '').slice(0, 10)}`;
}
