import { withQuery } from './url';

export const SUPPORT_STATUSES = ['open', 'answered', 'closed'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Статус очереди из адреса; незнакомый — «Ждут ответа». */
export const readSupportStatus = (v: string | null | undefined): SupportStatus =>
  SUPPORT_STATUSES.find((s) => s === v) ?? 'open';

/** Адрес очереди поддержки в консоли с фильтром и поиском — тот, что она держит в адресе. */
export const supportQueueUrl = (status: SupportStatus, q: string) =>
  withQuery('/admin', { tab: 'support', status: status !== 'open' && status, q: q.trim() });

/**
 * Обращение из очереди: с какого списка ушли — в `?back=`, чтобы «← Очередь
 * поддержки» вернула к тому же фильтру и поиску, а не к «Ждут ответа».
 */
export const ticketUrl = (id: string, back: string) =>
  withQuery(`/cabinet/support/${id}`, { back });

/**
 * Куда вернуться из обращения. Из `back` берутся только статус и поиск — что
 * бы туда ни подложили, ведёт он только в очередь поддержки.
 */
export function backToSupportQueue(back: string | null | undefined): string {
  let p = new URLSearchParams();
  try {
    if (back) p = new URL(back, 'http://local').searchParams;
  } catch {
    // Негодный адрес — просто очередь.
  }
  return supportQueueUrl(readSupportStatus(p.get('status')), p.get('q') ?? '');
}
