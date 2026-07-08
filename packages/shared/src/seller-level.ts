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
