const SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/** "150000" (копейки), RUB → "1 500 ₽". Разделяет тысячи узким пробелом. */
export function formatPrice(minor: string, currency = 'RUB'): string {
  const major = Number(BigInt(minor)) / 100;
  const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(major);
  return `${num} ${SYMBOLS[currency] ?? currency}`;
}

/** Количество с единицей лота: «25 000 золота», «3 шт.». */
export function formatQty(qty: number, unitName?: string | null): string {
  return `${new Intl.NumberFormat('ru-RU').format(qty)} ${unitName ?? 'шт.'}`;
}

/** Подпись к цене поштучного лота: «за 1 000 золота». null — лот продаётся целиком. */
export function perPackLabel(l: { unitName?: string | null; pricePerUnits?: number }): string | null {
  return l.unitName ? `за ${formatQty(l.pricePerUnits ?? 1, l.unitName)}` : null;
}

/**
 * Цена лота на витрине. У лота «на сумму покупателя» в price лежит цена
 * минимальной суммы — без «от» она читалась бы как цена любого пополнения.
 * У поштучного лота цена указана за пачку — без «за 1 000 золота» 15 ₽
 * читались бы как цена всего лота.
 */
export function formatListingPrice(l: {
  price: string;
  currency: string;
  topupMarkupBps?: number | null;
  unitName?: string | null;
  pricePerUnits?: number;
}): string {
  const price = formatPrice(l.price, l.currency);
  if (l.topupMarkupBps != null) return `от ${price}`;
  const pack = perPackLabel(l);
  return pack ? `${price} ${pack}` : price;
}
