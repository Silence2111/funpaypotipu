/**
 * Данные от покупателя при покупке — как поля «ник», «сервер» у лотов
 * Playerok. Продавец ручной выдачи задаёт до трёх полей, покупатель
 * заполняет их до оплаты, продавец видит ответы в заказе — без переписки
 * «а какой у вас ник?».
 *
 * Без zod: модуль идёт в браузер, схема для API — в contracts/catalog.ts.
 */

export interface BuyerField {
  label: string;
  required: boolean;
  /**
   * Тип поля (часть 142): «steam_trade» — ссылка на обмен Steam, с проверкой
   * формата; запоминается в профиле покупателя и подставляется в следующий
   * заказ. Без типа — обычный текст.
   */
  kind?: 'steam_trade';
}

export const STEAM_TRADE_LABEL = 'Ссылка на обмен Steam';
const STEAM_TRADE = /^https:\/\/steamcommunity\.com\/tradeoffer\/new\/\?partner=\d{1,12}&token=[A-Za-z0-9_-]{8}$/;

/** Ссылка на обмен Steam: https://steamcommunity.com/tradeoffer/new/?partner=…&token=… */
export function isSteamTradeUrl(v: string): boolean {
  return STEAM_TRADE.test(v.trim());
}

export const BUYER_FIELDS_MAX = 3;
export const BUYER_VALUE_MAX = 100;

/** Поля лота из базы: всё, что не похоже на поле, отбрасывается. */
export function buyerFieldsOf(raw: unknown): BuyerField[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((f): f is BuyerField => !!f && typeof f.label === 'string' && f.label.trim().length > 0)
    .map((f) => ({ label: f.label.trim(), required: f.required !== false, ...(f.kind === 'steam_trade' ? { kind: 'steam_trade' as const } : {}) }))
    .slice(0, BUYER_FIELDS_MAX);
}

/** Почему ответы покупателя не годятся, или null. */
export function buyerDataError(fields: BuyerField[], data: Record<string, string> | undefined): string | null {
  for (const f of fields) {
    const v = data?.[f.label]?.trim() ?? '';
    if (f.required && !v) return `Укажите «${f.label}»`;
    if (v.length > BUYER_VALUE_MAX) return `«${f.label}» — не длиннее ${BUYER_VALUE_MAX} символов`;
    if (f.kind === 'steam_trade' && v && !isSteamTradeUrl(v)) {
      return 'Ссылка на обмен Steam — вида https://steamcommunity.com/tradeoffer/new/?partner=…&token=… (Steam → Инвентарь → Предложения обмена → «Кто может отправлять мне предложения»)';
    }
  }
  return null;
}

/** Ответы в порядке полей лота; лишние ключи и пустые необязательные — не сохраняются. */
export function cleanBuyerData(fields: BuyerField[], data: Record<string, string> | undefined) {
  return fields
    .map((f) => ({ label: f.label, value: data?.[f.label]?.trim() ?? '' }))
    .filter((a) => a.value.length > 0);
}
