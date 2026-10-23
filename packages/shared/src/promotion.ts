/**
 * Платное продвижение лота с баланса — как продвижение у Playerok: лот
 * стоит выше в своём разделе, пока идёт оплаченный срок. Цену суток
 * задаёт площадка (PROMO_DAY_PRICE), сроки — фиксированные пакеты.
 */
import type { Minor } from './money';

export const PROMO_DAYS = [1, 3, 7] as const;
export type PromoDays = (typeof PROMO_DAYS)[number];

/**
 * Как часто можно бесплатно поднять лот, в часах: чем больше продаж, тем
 * чаще — как у FunPay. Тот же порог называет «Помощь».
 */
export const bumpCooldownHours = (sales: number): number => (sales >= 50 ? 1 : sales >= 10 ? 2 : 4);

/** Стоимость пакета: сутки × дни, без скидок — проще сверять с выпиской. */
export const promoCost = (dayPrice: Minor, days: number): Minor => dayPrice * BigInt(days);

/** Новый срок: продление считается от конца текущего, а не от сейчас. */
export function promoUntil(current: Date | null, days: number, now = new Date()): Date {
  const from = current && current > now ? current : now;
  return new Date(from.getTime() + days * 24 * 3600 * 1000);
}
