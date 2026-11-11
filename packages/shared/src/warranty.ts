/**
 * Гарантия продавца в днях (часть 126): после подтверждения получения
 * покупатель ещё столько дней может открыть спор, а деньги продавцу
 * приходят, когда гарантия закончится. Как гарантия на ключи и предметы
 * у продавцов FunPay, только деньги на это время держит площадка.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Сроки гарантии, из которых выбирает продавец. */
export const WARRANTY_DAYS = [1, 3, 7, 14, 30] as const;

/** У валюты и пополнений гарантии нет: проверяется сразу при получении. */
export const NO_WARRANTY_SEGMENTS = ['currency', 'topup'] as const;

export function isWarrantyDays(days: unknown): days is number {
  return typeof days === 'number' && (WARRANTY_DAYS as readonly number[]).includes(days);
}

/** До какого времени гарантия: от подтверждения плюс срок. */
export function warrantyUntil(confirmedAt: Date, days: number): Date {
  return new Date(confirmedAt.getTime() + days * 86_400_000);
}

/** Идёт гарантия: заказ подтверждён, деньги ещё у площадки, срок не вышел. */
export function warrantyActive(
  o: { status: string; warrantyUntil?: Date | string | null; warrantyReleasedAt?: Date | string | null },
  now = new Date(),
): boolean {
  return (
    o.status === 'completed' &&
    !!o.warrantyUntil &&
    !o.warrantyReleasedAt &&
    new Date(o.warrantyUntil).getTime() > now.getTime()
  );
}
