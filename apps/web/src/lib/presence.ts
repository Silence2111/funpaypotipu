/** «В сети» — был на сайте за последние 5 минут; тот же порог у фильтра API. */
export const ONLINE_MS = 5 * 60 * 1000;

export function isOnline(onlineAt?: string | null, now = Date.now()): boolean {
  return !!onlineAt && now - new Date(onlineAt).getTime() < ONLINE_MS;
}

/** «в сети», «был 12 мин назад», «был 3 дн назад»; null — не заходил ни разу. */
export function presenceText(onlineAt?: string | null, now = Date.now()): string | null {
  if (!onlineAt) return null;
  if (isOnline(onlineAt, now)) return 'в сети';
  const mins = Math.floor((now - new Date(onlineAt).getTime()) / 60000);
  if (mins < 60) return `был ${mins} мин назад`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `был ${h} ч назад`;
  return `был ${Math.floor(h / 24)} дн назад`;
}
