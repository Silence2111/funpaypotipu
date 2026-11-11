/**
 * API для продавцов (часть 127): ключи, лоты и остатки, заказы и выдача,
 * вебхук «оплачен новый заказ». То, ради чего на FunPay ставят сторонних
 * ботов с паролем от аккаунта, — здесь по ключу, который можно отозвать.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Ключ начинается с этого: в логах и чатах его видно и легко отозвать. */
export const API_KEY_PREFIX = 'gm_live_';
/** Действующих ключей у продавца. */
export const API_KEYS_MAX = 5;
/** Запросов в минуту на ключ. */
export const API_RATE_PER_MIN = 60;
/** Журнал запросов хранится столько дней. */
export const API_LOG_DAYS = 30;
/** Строк склада за один запрос. */
export const API_STOCK_MAX = 500;

/** События вебхука. */
export const WEBHOOK_EVENTS = ['order.paid', 'ping'] as const;
export type SellerWebhookEvent = (typeof WEBHOOK_EVENTS)[number];
/** Паузы между попытками доставки вебхука, минуты: всего 6 попыток. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 360] as const;

/** Ключ для показа в списке: «gm_live_ab12…». */
export function apiKeyHint(prefix: string): string {
  return `${prefix}…`;
}
