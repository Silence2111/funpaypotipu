import { RU, type T } from './i18n/lang';

/** «В сети» — был на сайте за последние 5 минут; тот же порог у фильтра API. */
export const ONLINE_MS = 5 * 60 * 1000;

export function isOnline(onlineAt?: string | null, now = Date.now()): boolean {
  return !!onlineAt && now - new Date(onlineAt).getTime() < ONLINE_MS;
}

/** «в сети», «в сети 12 мин назад», «в сети 3 дн назад»; null — не заходил ни разу. */
export function presenceText(onlineAt?: string | null, now = Date.now(), t: T = RU): string | null {
  if (!onlineAt) return null;
  if (isOnline(onlineAt, now)) return t('в сети');
  const mins = Math.floor((now - new Date(onlineAt).getTime()) / 60000);
  if (mins < 60) return t('в сети {n} мин назад', { n: mins });
  const h = Math.floor(mins / 60);
  if (h < 24) return t('в сети {n} ч назад', { n: h });
  return t('в сети {n} дн назад', { n: Math.floor(h / 24) });
}

// i18n-ignore-start
const MONTHS_GEN = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
// i18n-ignore-end

/**
 * «с октября 2026» / «since October 2026». По-русски toLocaleDateString с
 * одним месяцем даёт «с октябрь 2026 г.» — месяц в родительном падеже свой.
 */
export function sinceText(iso: string, t: T = RU): string {
  const d = new Date(iso);
  if (t.lang === 'en')
    return `since ${d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
  return `с ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; // i18n-ignore
}
