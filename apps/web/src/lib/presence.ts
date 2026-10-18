/** «В сети» — был на сайте за последние 5 минут; тот же порог у фильтра API. */
export const ONLINE_MS = 5 * 60 * 1000;

export function isOnline(onlineAt?: string | null, now = Date.now()): boolean {
  return !!onlineAt && now - new Date(onlineAt).getTime() < ONLINE_MS;
}

/** «в сети», «в сети 12 мин назад», «в сети 3 дн назад»; null — не заходил ни разу. */
export function presenceText(onlineAt?: string | null, now = Date.now()): string | null {
  if (!onlineAt) return null;
  if (isOnline(onlineAt, now)) return 'в сети';
  const mins = Math.floor((now - new Date(onlineAt).getTime()) / 60000);
  if (mins < 60) return `в сети ${mins} мин назад`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `в сети ${h} ч назад`;
  return `в сети ${Math.floor(h / 24)} дн назад`;
}

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

/** «с октября 2026»: toLocaleDateString с одним месяцем даёт «с октябрь 2026 г.». */
export function sinceText(iso: string): string {
  const d = new Date(iso);
  return `с ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}
