import { withQuery } from './url';

export type DisputesState = 'open' | 'closed';

/** Вкладка очереди споров из адреса; незнакомая — «Открытые». */
export const readDisputesState = (v: string | null | undefined): DisputesState =>
  v === 'closed' ? 'closed' : 'open';

/** Адрес очереди споров в консоли с вкладкой и поиском — тот, что она держит в адресе. */
export const disputesQueueUrl = (state: DisputesState, q: string) =>
  withQuery('/admin', { tab: 'disputes', state: state === 'closed' && state, q: q.trim() });

/** Спор из очереди: с какого списка ушли — в `?back=`, чтобы вернуться к нему же. */
export const disputeUrl = (id: string, back: string) => withQuery(`/disputes/${id}`, { back });

/**
 * Куда вернуться со спора. Из `back` берутся только вкладка и поиск — что
 * бы туда ни подложили, ведёт он только в очередь споров.
 */
export function backToDisputesQueue(back: string): string {
  let p = new URLSearchParams();
  try {
    p = new URL(back, 'http://local').searchParams;
  } catch {
    // Негодный адрес — просто очередь.
  }
  return disputesQueueUrl(readDisputesState(p.get('state')), p.get('q') ?? '');
}
