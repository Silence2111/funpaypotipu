/**
 * «Вы недавно смотрели»: id последних открытых лотов — в браузере, без
 * входа и без сервера. Свежий — первым, повтор поднимается наверх.
 */

const KEY = 'gm_recent';
export const RECENT_MAX = 12;

export function recentLots(): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw)
      ? raw.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

export function rememberLot(id: string) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify([id, ...recentLots().filter((x) => x !== id)].slice(0, RECENT_MAX)),
    );
  } catch {
    // Приватный режим без хранилища — без истории.
  }
}

export function clearRecent() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Нечего очищать.
  }
}
