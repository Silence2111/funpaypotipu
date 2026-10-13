'use client';

/** Подписи статусов для консоли — одни на все разделы. */
export const LISTING_STATUS: Record<string, string> = {
  active: 'в продаже',
  paused: 'снят',
  sold_out: 'закончился',
  blocked: 'заблокирован',
  draft: 'черновик',
  archived: 'в архиве',
};

export const USER_STATUS: Record<string, string> = {
  active: 'активен',
  frozen: 'заморожен',
  banned: 'забанен',
};

export const ROLE_LABEL: Record<string, string> = {
  admin: 'администратор',
  moderator: 'модератор',
  agent: 'арбитр',
  finance: 'финансы',
  seller: 'продавец',
  buyer: 'покупатель',
};

export const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Бейдж статуса: проблемные — заметнее, остальные — тихие. */
export function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  const tone = status === 'banned' || status === 'blocked' ? 'badge danger' : status === 'frozen' ? 'badge warning' : 'badge';
  return <span className={tone}>{labels[status] ?? status}</span>;
}

/** Пустой раздел или ошибка доступа — одной строкой, без декора. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted" style={{ margin: 0 }}>{children}</p>;
}
