/**
 * Услуги со сроком выполнения (часть 125): прокачка нет — она закрыта, а
 * обучение, постройки, сопровождение, дизайн — да. Продавец задаёт срок у
 * лота; после оплаты у заказа — «выполнить до». Срок вышел — покупатель
 * сразу может открыть спор; без выдачи и спора через сутки деньги
 * возвращаются сами (вместо обычных 24 ч с оплаты у ручной выдачи).
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Сроки, из которых выбирает продавец, — в днях. */
export const SERVICE_TERM_DAYS = [1, 2, 3, 5, 7, 14, 30] as const;
/** Срок у лота хранится в часах. */
export const SERVICE_TERM_HOURS: readonly number[] = SERVICE_TERM_DAYS.map((d) => d * 24);
/** Сколько ждём после срока, прежде чем вернуть деньги, если спора нет. */
export const SERVICE_GRACE_HOURS = 24;

export function isServiceTerm(hours: unknown): hours is number {
  return typeof hours === 'number' && SERVICE_TERM_HOURS.includes(hours);
}

/** «Выполнить до»: от оплаты плюс срок лота. */
export function serviceDueAt(paidAt: Date, hours: number): Date {
  return new Date(paidAt.getTime() + hours * 3600_000);
}

/** Срок вышел, а заказ не выполнен. */
export function serviceOverdue(o: { status: string; serviceDueAt?: Date | string | null }, now = new Date()): boolean {
  return o.status === 'paid' && !!o.serviceDueAt && new Date(o.serviceDueAt).getTime() <= now.getTime();
}
