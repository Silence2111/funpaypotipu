/**
 * Партнёрская программа (часть 116) — механизм без цифр. Долю и срок задаёт
 * администратор в консоли; по умолчанию программа выключена: пока владелец
 * не решил, сколько платить, площадка ничего не обещает и не начисляет.
 *
 * Партнёр делится ссылкой `/?ref=КОД` или кодом. Кто зарегистрировался по ней
 * в первые сутки, тот привязан к партнёру. С каждой завершённой сделки
 * привлечённого — покупки или продажи — партнёру уходит доля от того, что
 * осталось площадке после эквайринга и кэшбэка (`dealEconomics().net`), на
 * баланс; вывод — обычный.
 */

export interface PartnerSettings {
  enabled: boolean;
  /** Доля партнёра от остатка площадки со сделки, в базисных пунктах (1% = 100). */
  shareBps: number;
  /** Сколько дней после привязки сделки привлечённого приносят партнёру. */
  termDays: number;
}

/** Ключ в system_settings. */
export const PARTNER_SETTINGS_KEY = 'partner_program';

/** По умолчанию — выключено и без цифр. */
export const PARTNER_DEFAULTS: PartnerSettings = { enabled: false, shareBps: 0, termDays: 0 };

/** Больше половины остатка партнёру не отдать: площадке тоже надо жить. */
export const PARTNER_MAX_SHARE_BPS = 5000;
/** Срок — до десяти лет. */
export const PARTNER_MAX_TERM_DAYS = 3650;
/** Привязаться к партнёру можно в первые сутки после регистрации. */
export const PARTNER_ATTACH_HOURS = 24;
/** Сколько живёт код из ссылки в браузере, пока человек не зарегистрируется. */
export const PARTNER_REF_DAYS = 30;

/** Код партнёра: 6–12 латинских букв и цифр, без 0/O и 1/I — чтобы не путать. */
export const PARTNER_CODE_RE = /^[A-HJ-NP-Z2-9]{6,12}$/;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function normalizePartnerCode(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim().toUpperCase();
  return PARTNER_CODE_RE.test(code) ? code : null;
}

/** Новый код; `random` — для тестов. */
export function newPartnerCode(random: () => number = Math.random, length = 8): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return s;
}

/** Настройки из базы — с проверкой: битое значение — выключено. */
export function partnerSettings(raw: unknown): PartnerSettings {
  if (!raw || typeof raw !== 'object') return { ...PARTNER_DEFAULTS };
  const v = raw as Record<string, unknown>;
  const shareBps = Number(v.shareBps);
  const termDays = Number(v.termDays);
  const ok =
    Number.isInteger(shareBps) &&
    shareBps >= 0 &&
    shareBps <= PARTNER_MAX_SHARE_BPS &&
    Number.isInteger(termDays) &&
    termDays >= 0 &&
    termDays <= PARTNER_MAX_TERM_DAYS;
  if (!ok) return { ...PARTNER_DEFAULTS };
  return { enabled: v.enabled === true, shareBps, termDays };
}

/** Работает ли программа: включена, доля и срок заданы. */
export const partnerActive = (s: PartnerSettings): boolean => s.enabled && s.shareBps > 0 && s.termDays > 0;

/** Доля партнёра с остатка площадки; остаток не в плюсе — ноль. Вниз до копейки. */
export function partnerShare(net: bigint, shareBps: number): bigint {
  if (net <= 0n || shareBps <= 0) return 0n;
  return (net * BigInt(shareBps)) / 10000n;
}

/** Сделка — в сроке: завершена не позже `termDays` дней после привязки. */
export function withinPartnerTerm(referredAt: Date, at: Date, termDays: number): boolean {
  return at.getTime() >= referredAt.getTime() && at.getTime() - referredAt.getTime() <= termDays * 24 * 3600_000;
}
