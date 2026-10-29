import { withQuery } from './url';

const MY_LOTS = '/cabinet/lots';

/** Адрес «Моих лотов» с фильтром и поиском — тот, что страница держит в адресе. */
export const myLotsUrl = (f: string, q: string) =>
  withQuery(MY_LOTS, { f: f !== 'all' && f, q: q.trim() });

/**
 * Правка лота из «Моих лотов»: с какого списка ушли — в `?back=`, чтобы после
 * сохранения вернуться к тому же фильтру и поиску, а не ко всем лотам.
 */
export const editLotUrl = (id: string, back: string) => withQuery(`/cabinet/lot/${id}`, { back });

/**
 * Куда вернуться с правки: «Мои лоты» с фильтром и поиском из `back`;
 * `updated` — какой лот подсветить. Из `back` берутся только фильтр и поиск —
 * что бы туда ни подложили, ведёт он только в «Мои лоты».
 */
export function backToMyLots(back: string | null | undefined, updated?: string): string {
  let p = new URLSearchParams();
  try {
    if (back) p = new URL(back, 'http://local').searchParams;
  } catch {
    // Негодный адрес — просто все лоты.
  }
  return withQuery(MY_LOTS, { f: p.get('f'), q: p.get('q'), updated });
}
