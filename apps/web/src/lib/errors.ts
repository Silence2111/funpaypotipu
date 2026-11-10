import { documentLang } from './i18n/lang';

/**
 * Текст ошибки API для человека.
 *
 * apiFetch бросает Error с телом ответа. У Nest это JSON вида
 * {"message": "...", "statusCode": 409}; message бывает массивом (валидация).
 * Раньше формы показывали одно на всё — «Не удалось…», и человек не знал,
 * что исправить. Текст сервера показываем, когда он написан для человека:
 * русский — на русском сайте, переведённый API (`lang: "en"`) — на
 * английском. Технический текст Nest («Unauthorized») заменяем на запасной.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  const en = documentLang() === 'en';
  try {
    const body = JSON.parse(raw) as { message?: string | string[]; lang?: string };
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    if (msg && (en ? body.lang === 'en' : /[а-яё]/i.test(msg))) return msg; // i18n-ignore
  } catch {
    /* не JSON — ниже запасной текст */
  }
  if (/Failed to fetch|NetworkError/i.test(raw)) {
    return en
      ? 'No connection to the server. Check your internet and try again.'
      : 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'; // i18n-ignore
  }
  return fallback;
}

/** Тело ошибки API целиком: код ошибки и подсказки вроде предложенного ника. */
export function errorBody(
  e: unknown,
): { error?: string; message?: string; [k: string]: unknown } | null {
  try {
    return JSON.parse(e instanceof Error ? e.message : '') as { error?: string };
  } catch {
    return null;
  }
}

/** Код ошибки из тела ответа: two_factor_required, too_many_attempts… */
export function errorCode(e: unknown): string | null {
  return errorBody(e)?.error ?? null;
}
