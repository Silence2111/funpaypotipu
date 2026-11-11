/**
 * Общий чат игры (часть 133) — как чат на странице игры у FunPay: «скупаю
 * скины», «кто продаст голду». Сделки — только через лоты: контакты и
 * ссылки скрываются, новичкам — реже, спам и повторы — отказ, жалоба на
 * сообщение — в очередь модерации, удаление и запрет писать — в консоли.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Длина сообщения: чат — не объявления. */
export const GAME_CHAT_MAX_LEN = 300;
/** Сколько сообщений отдаём за раз. */
export const GAME_CHAT_PAGE = 50;
/** Пауза между сообщениями, секунды: у всех и у новичка. */
export const GAME_CHAT_COOLDOWN_SEC = 10;
export const GAME_CHAT_NEWBIE_COOLDOWN_SEC = 60;
/** Сообщений в сутки у новичка (моложе 72 ч без сделок). */
export const GAME_CHAT_NEWBIE_PER_DAY = 20;
/** Тот же текст повторно в течение стольких минут — спам. */
export const GAME_CHAT_REPEAT_MIN = 10;
/** На сколько запрещают писать в чат: сутки, неделя, месяц. */
export const GAME_CHAT_MUTE_HOURS = [24, 168, 720] as const;

/** Текст для сравнения повторов: без регистра, пробелов и знаков. */
export function chatFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Заглавными больше половины букв, от 12 букв, — крик, а не сообщение. */
export function isShouting(text: string): boolean {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 12) return false;
  const upper = letters.filter((c) => c !== c.toLowerCase() && c === c.toUpperCase()).length;
  return upper / letters.length > 0.7;
}
