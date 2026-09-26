/**
 * Текст ошибки API для человека.
 *
 * apiFetch бросает Error с телом ответа. У Nest это JSON вида
 * {"message": "...", "statusCode": 409}; message бывает массивом (валидация).
 * Раньше формы показывали одно на всё — «Не удалось…», и человек не знал,
 * что исправить. Русский текст сервера показываем как есть, английский
 * (технический) заменяем на запасной.
 */
export function apiErrorMessage(e: unknown, fallback: string): string {
  const raw = e instanceof Error ? e.message : '';
  try {
    const body = JSON.parse(raw) as { message?: string | string[] };
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    if (msg && /[а-яё]/i.test(msg)) return msg;
  } catch {
    /* не JSON — ниже запасной текст */
  }
  if (/Failed to fetch|NetworkError/i.test(raw)) {
    return 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.';
  }
  return fallback;
}
