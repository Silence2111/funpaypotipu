import { RU, type T } from './i18n/lang';

const SYMBOLS: Record<string, string> = { RUB: '₽', USD: '$', EUR: '€' };

/**
 * "150000" (копейки), RUB → "1 500 ₽", "73080" → "730,80 ₽". Разделяет тысячи
 * узким пробелом; копейки — двумя знаками или никак, а не «730,8».
 * По-английски — «1,500 ₽» и «730.80 ₽».
 */
export function formatPrice(minor: string, currency = 'RUB', t: T = RU): string {
  const value = BigInt(minor);
  const kopecks = value % 100n !== 0n;
  const num = new Intl.NumberFormat(t.locale, {
    minimumFractionDigits: kopecks ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(Number(value) / 100);
  return `${num} ${SYMBOLS[currency] ?? currency}`;
}

export const currencySymbol = (currency: string) => SYMBOLS[currency] ?? currency;

/** Цена для поля ввода: "120050" → «1200,50», "120000" → «1200». */
export function minorToInput(minor: string): string {
  const v = BigInt(minor);
  const kop = v % 100n;
  return kop ? `${v / 100n},${kop.toString().padStart(2, '0')}` : String(v / 100n);
}

/** Ввод цены: «1 200,50» → 120050n копеек; null — не цена или не больше нуля. */
export function parseMoneyInput(raw: string): bigint | null {
  const t = raw.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const minor = BigInt(whole!) * 100n + BigInt(`${frac}00`.slice(0, 2));
  return minor > 0n ? minor : null;
}

/** Количество с единицей лота: «25 000 золота», «3 шт.». */
export function formatQty(qty: number, unitName?: string | null, t: T = RU): string {
  return unitName ? `${t.num(qty)} ${t.d(unitName)}` : t.n(qty, 'шт.', 'шт.', 'шт.');
}

/** Подпись к цене поштучного лота: «за 1 000 золота». null — лот продаётся целиком. */
export function perPackLabel(l: { unitName?: string | null; pricePerUnits?: number }, t: T = RU): string | null {
  return l.unitName ? t('за {qty}', { qty: formatQty(l.pricePerUnits ?? 1, l.unitName, t) }) : null;
}

/**
 * Цена лота на витрине. У лота «на сумму покупателя» в price лежит цена
 * минимальной суммы — без «от» она читалась бы как цена любого пополнения.
 * У поштучного лота цена указана за пачку — без «за 1 000 золота» 15 ₽
 * читались бы как цена всего лота.
 */
export function formatListingPrice(
  l: {
    price: string;
    currency: string;
    topupMarkupBps?: number | null;
    unitName?: string | null;
    pricePerUnits?: number;
  },
  t: T = RU,
): string {
  const price = formatPrice(l.price, l.currency, t);
  if (l.topupMarkupBps != null) return t('от {price}', { price });
  const pack = perPackLabel(l, t);
  return pack ? `${price} ${pack}` : price;
}

/** «1 предложение», «3 предложения», «25 предложений». */
export const offersCount = (n: number, t: T = RU) => t.n(n, 'предложение', 'предложения', 'предложений');

/** «1 продавец», «3 продавца», «25 продавцов». */
export const sellersCount = (n: number, t: T = RU) => t.n(n, 'продавец', 'продавца', 'продавцов');

/** «18 ч 20 мин» до срока; прошёл — пусто. Срок ответа в споре — на его странице и в плашке. */
export function timeLeft(iso: string, t: T = RU): string | null {
  const min = Math.ceil((Date.parse(iso) - Date.now()) / 60000);
  if (min <= 0) return null;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return t('{m} мин', { m });
  return m ? t('{h} ч {m} мин', { h, m }) : t('{h} ч', { h });
}
