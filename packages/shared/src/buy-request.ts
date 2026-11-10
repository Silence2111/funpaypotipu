/**
 * Запросы покупателей «Хочу купить» (часть 115). Покупатель пишет в разделе
 * игры, что ищет и до какой цены; продавцам раздела приходит уведомление,
 * продавец отвечает своим лотом — покупателю ссылка на лот. Так пустой
 * раздел на старте площадки не тупик: спрос виден продавцам раньше
 * предложений.
 */

/** Сколько дней запрос виден продавцам; потом — «истёк». */
export const BUY_REQUEST_DAYS = 7;
/** Открытых запросов у одного человека — не больше. */
export const MAX_OPEN_BUY_REQUESTS = 5;
/** Новых запросов за сутки — не больше: закрыть и создать снова — тоже запрос. */
export const MAX_BUY_REQUESTS_PER_DAY = 10;
/** Текст запроса: «Аккаунт с Prime и ножом, от 1000 часов». */
export const BUY_REQUEST_TEXT_MIN = 10;
export const BUY_REQUEST_TEXT_MAX = 300;
/** Лотов от одного продавца на один запрос — не больше. */
export const MAX_OFFERS_PER_SELLER = 3;
/** Скольким продавцам раздела рассылать: кто был на сайте последним — первыми. */
export const BUY_REQUEST_NOTIFY_LIMIT = 300;
/** Продавец раздела — у него лот в продаже и он заходил за столько дней. */
export const BUY_REQUEST_SELLER_ACTIVE_DAYS = 30;

export type BuyRequestState = 'open' | 'expired' | 'closed' | 'removed';

/** Истёк — открытый запрос после срока: отдельного статуса в базе нет. */
export function buyRequestState(
  r: { status: 'open' | 'closed' | 'removed'; expiresAt: Date | string },
  now: Date = new Date(),
): BuyRequestState {
  if (r.status !== 'open') return r.status;
  return new Date(r.expiresAt).getTime() <= now.getTime() ? 'expired' : 'open';
}

/** Когда истечёт запрос, созданный в `at`. */
export function buyRequestExpiry(at: Date = new Date()): Date {
  return new Date(at.getTime() + BUY_REQUEST_DAYS * 24 * 3600_000);
}

/**
 * Подходит ли лот под «до какой цены»: цена за ту же пачку, что показывает
 * раздел. Без предела — любой. Дороже — продавец всё равно может
 * предложить, но покупатель видит, что лот выше его цены.
 */
export function withinBudget(price: bigint | number | string, maxPrice: bigint | number | string | null): boolean {
  if (maxPrice == null) return true;
  return BigInt(price) <= BigInt(maxPrice);
}
