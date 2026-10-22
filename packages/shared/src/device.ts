const EN: Record<string, string> = {
  'Неизвестное устройство': 'Unknown device',
  'Яндекс Браузер': 'Yandex Browser',
  Браузер: 'Browser',
};

/**
 * Устройство по строке браузера — «Chrome · Windows». Для письма о входе с
 * нового устройства: названия как в списке сеансов «Безопасности».
 */
export function deviceOf(ua: string | null | undefined, lang: 'ru' | 'en' = 'ru'): string {
  const word = (ru: string) => (lang === 'en' ? (EN[ru] ?? ru) : ru);
  if (!ua) return word('Неизвестное устройство');
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /YaBrowser/.test(ua)
        ? 'Яндекс Браузер'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Браузер';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${word(browser)} · ${os}` : word(browser);
}
