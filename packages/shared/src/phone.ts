/**
 * Вход по номеру телефона (часть 121). Ч. 10 ст. 8 149-ФЗ: россиян сайт
 * авторизует по абонентскому номеру российского оператора, через Госуслуги
 * или биометрию. Номер — только российский мобильный: +7 9XX. Казахстан
 * тоже +7, но 6XX и 7XX — такие не принимаем.
 *
 * Без zod и без Node: модуль идёт и в браузер.
 */

/** Цифр в коде из SMS. */
export const PHONE_CODE_LENGTH = 6;
/** Сколько живёт код. */
export const PHONE_CODE_TTL_SEC = 5 * 60;
/** Неверных вводов на один код — дальше только новый. */
export const PHONE_CODE_ATTEMPTS = 5;
/** Пауза между кодами на один номер. */
export const PHONE_RESEND_SEC = 60;
/** Кодов на один номер в час и в сутки: SMS стоят денег, а номер — чужой человек. */
export const PHONE_CODES_PER_HOUR = 5;
export const PHONE_CODES_PER_DAY = 10;

export const PHONE_INVALID = 'Номер — российский мобильный: +7 9XX XXX-XX-XX';

/**
 * Номер в виде +79XXXXXXXXX или null. Принимает «8 999 123-45-67»,
 * «+7 (999) 123 45 67», «9991234567».
 */
export function normalizeRuPhone(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = d.slice(1);
  if (d.length !== 10 || !d.startsWith('9')) return null;
  return `+7${d}`;
}

/** +7 999 123-45-67 — как пишут номер в России. */
export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return phone;
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

/** +7 999 ***-**-67 — в уведомлениях и чужих экранах. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-10);
  if (d.length !== 10) return '***';
  return `+7 ${d.slice(0, 3)} ***-**-${d.slice(8)}`;
}

/** Текст SMS: код, площадка и предупреждение — как у банков. */
export function phoneCodeText(code: string): string {
  return `${code} — код входа на GameMarket. Никому не сообщайте его, даже поддержке.`;
}
