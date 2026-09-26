/**
 * Уровень продавца — наш дифференциатор против «плоских» 10–20% у конкурентов.
 * Уровень растёт от продаж + рейтинга + верификации и даёт:
 *  - feeDiscountBps — скидку с комиссии площадки (в базисных пунктах, 100 bps = 1%);
 *  - holdHours — срок авто-подтверждения (холда) заказа: доверенным быстрее.
 * Экономику (комиссия/холд) подключают FeesService и OrdersService.
 */
export type SellerLevelKey = 'new' | 'trusted' | 'pro';

export interface SellerLevel {
  key: SellerLevelKey;
  label: string;
  feeDiscountBps: number;
  holdHours: number;
}

export interface SellerStats {
  salesCount: number;
  ratingAvg: number;
  ratingCount: number;
  verified: boolean;
}

export const SELLER_LEVELS: Record<SellerLevelKey, SellerLevel> = {
  new: { key: 'new', label: 'Новичок', feeDiscountBps: 0, holdHours: 72 },
  trusted: { key: 'trusted', label: 'Проверенный', feeDiscountBps: 150, holdHours: 24 },
  pro: { key: 'pro', label: 'Pro-продавец', feeDiscountBps: 300, holdHours: 12 },
};

export function sellerLevel(s: SellerStats): SellerLevel {
  if (s.verified && s.salesCount >= 50 && s.ratingCount >= 20 && s.ratingAvg >= 4.7) {
    return SELLER_LEVELS.pro;
  }
  if (s.salesCount >= 10 && s.ratingAvg >= 4.5) {
    return SELLER_LEVELS.trusted;
  }
  return SELLER_LEVELS.new;
}

/**
 * Скидка уровня как ДОЛЯ — в тех же единицах, что `FeeRule.feeSellerPct` (0.07 = 7%).
 *
 * Почему отдельная функция. Ставка в правиле хранится долей, скидка уровня —
 * в базисных пунктах. Раньше `FeesService` вычитал `feeDiscountBps / 100`,
 * то есть процентные ПУНКТЫ (3), из ДОЛИ (0.07): 0.07 − 3 < 0 → `max(0, …)` = 0.
 * Каждый «Проверенный» и «Pro»-продавец платил нулевую комиссию, хотя витрина
 * обещала 7–10% минус до 3 п.п. Площадка переставала зарабатывать ровно
 * на тех, кто делает оборот. Перевод единиц теперь живёт в одном месте.
 */
export const levelDiscountFraction = (level: SellerLevel): number =>
  level.feeDiscountBps / 10_000;

/** Ставка продавца после скидки уровня. Не ниже нуля. */
export function effectiveSellerPct(rulePct: number, level?: SellerLevel): number {
  if (!level) return rulePct;
  return Math.max(0, rulePct - levelDiscountFraction(level));
}
