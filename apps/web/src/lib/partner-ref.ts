import { PARTNER_REF_DAYS, normalizePartnerCode } from '@gamemarket/shared/partner';

/**
 * Код партнёра из ссылки `?ref=КОД` — в браузере, пока человек не
 * зарегистрируется (часть 116). После входа сайт один раз просит API
 * привязать аккаунт и забывает код: привязка — только в первые сутки после
 * регистрации, и это решает API.
 */
const KEY = 'gm_ref';

export function savedRef(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
      code?: string;
      at?: number;
    } | null;
    if (!v?.code || !v.at || Date.now() - v.at > PARTNER_REF_DAYS * 24 * 3600_000) return null;
    return normalizePartnerCode(v.code);
  } catch {
    return null;
  }
}

/** Запомнить код; true — новый (переход стоит посчитать). */
export function saveRef(raw: string | null | undefined): boolean {
  const code = normalizePartnerCode(raw);
  if (!code) return false;
  const fresh = savedRef() !== code;
  try {
    localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
  } catch {
    // Хранилище закрыто (приватный режим) — без привязки, сайт работает.
  }
  return fresh;
}

export function forgetRef() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // нечего забывать
  }
}
