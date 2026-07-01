const SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/** "150000" (копейки), RUB → "1 500 ₽". Разделяет тысячи узким пробелом. */
export function formatPrice(minor: string, currency = 'RUB'): string {
  const major = Number(BigInt(minor)) / 100;
  const num = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(major);
  return `${num} ${SYMBOLS[currency] ?? currency}`;
}
