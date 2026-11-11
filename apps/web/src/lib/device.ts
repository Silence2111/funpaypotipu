/**
 * Постоянный id браузера (часть 128): случайная строка в localStorage, не
 * отпечаток. Уходит в API с каждым запросом, сохраняется в сеансах входа —
 * так консоль видит аккаунты одного человека («общий браузер») и не даёт
 * им торговать между собой. Согласие: «IP, браузер и устройство» —
 * /soglasie. Выход из аккаунта id не сбрасывает.
 */
const KEY = 'gm_device';

export function deviceId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Заголовок для запросов к API — пустой, если id нет (приватный режим). */
export function deviceHeader(): Record<string, string> {
  const id = deviceId();
  return id ? { 'X-Device-Fingerprint': id } : {};
}
