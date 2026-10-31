'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { NOTIFY_GROUPS, NOTIFY_LABELS, notifyGroupOf, notifyLink } from '@gamemarket/shared/notify';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { isCurrentQuery, replaceUrl, withQuery } from '@/lib/url';
import { dayLabel } from '@/lib/chat';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';
import { noteText } from '@/lib/hidden';

interface Notif {
  id: string;
  type: string;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

interface Unread {
  total: number;
  groups: Partial<Record<string, number>>;
}

interface Page {
  items: Notif[];
  next: string | null;
  unread: Unread;
  /** Сколько прочитанных в выбранной группе — для «Убрать прочитанные». */
  read: number;
}

/** Сообщения живут в мессенджере, у них свой счётчик. */
const GROUPS = NOTIFY_GROUPS.filter((g) => g.key !== 'messages');

/** Уведомления по дням: «Сегодня», «Вчера», «25 октября» — список уже новыми сверху. */
function days(items: Notif[], now: Date, t: T) {
  const out: Array<{ label: string; items: Notif[] }> = [];
  for (const n of items) {
    const label = dayLabel(n.createdAt, now, t);
    const last = out.at(-1);
    if (last?.label === label) last.items.push(n);
    else out.push({ label, items: [n] });
  }
  return out;
}

/** Колокольчик в шапке перечитывает список, когда здесь что-то прочитали. */
const announce = () => window.dispatchEvent(new Event('gm-notifications'));

/** Строка итога: сколько убрали (со временем скрытия — для «Вернуть») или сколько вернули. */
type Done = { removed: number; at: string | null } | { restored: number };

/**
 * Все уведомления: колокольчик показывает последние, здесь — вся история,
 * новые сверху, по дням. Фильтр по группе с числом непрочитанных и «Только
 * непрочитанные» — в адресе страницы, чтобы «Назад» возвращал к тому же
 * списку. «Прочитать все» действует в выбранной группе.
 */
function NotificationsInner() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Фильтр меняется сразу, адрес догоняет; «Назад» возвращает фильтр из адреса.
  const [group, setGroup] = useState(params.get('group') ?? '');
  const [unreadOnly, setUnreadOnly] = useState(params.get('unread') === '1');
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setGroup(params.get('group') ?? '');
    setUnreadOnly(params.get('unread') === '1');
  }, [params]);
  const [items, setItems] = useState<Notif[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [unread, setUnread] = useState<Unread | null>(null);
  const [read, setRead] = useState(0);
  // «Убрать прочитанные» спрашивает подтверждение в той же строке.
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const query = useCallback(
    (before?: string) => {
      const q = new URLSearchParams();
      if (group) q.set('group', group);
      if (unreadOnly) q.set('unread', '1');
      if (before) q.set('before', before);
      return `/notifications/history?${q}`;
    },
    [group, unreadOnly],
  );

  const show = (p: Page) => {
    setItems(p.items);
    setNext(p.next);
    setUnread(p.unread);
    setRead(p.read);
  };

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cabinet/notifications')}`);
      return;
    }
    let stop = false;
    setItems(null);
    setErr(null);
    setConfirming(false);
    setDone(null);
    apiFetch<Page>(query())
      .then((p) => !stop && show(p))
      .catch((e) => !stop && setErr(apiErrorMessage(e, t('Не удалось загрузить уведомления.'))));
    return () => {
      stop = true;
    };
  }, [query, router, t]);

  function setFilter(nextGroup: string, nextUnread: boolean) {
    setGroup(nextGroup);
    setUnreadOnly(nextUnread);
    replaceUrl(withQuery(pathname, { group: nextGroup, unread: nextUnread && '1' }));
  }

  async function more() {
    if (!next) return;
    setBusy(true);
    try {
      const p = await apiFetch<Page>(query(next));
      setItems((prev) => [...(prev ?? []), ...p.items]);
      setNext(p.next);
      setUnread(p.unread);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось загрузить уведомления.')));
    } finally {
      setBusy(false);
    }
  }

  async function readAll() {
    setBusy(true);
    try {
      const r = await apiFetch<{ unread: Unread }>(
        `/notifications/read-all${group ? `?group=${encodeURIComponent(group)}` : ''}`,
        { method: 'POST' },
      );
      const now = new Date().toISOString();
      setRead((n) => n + pending);
      setUnread(r.unread);
      // В «только непрочитанных» прочитанным здесь не место.
      setItems((prev) =>
        unreadOnly ? [] : (prev ?? []).map((n) => (n.readAt ? n : { ...n, readAt: now })),
      );
      if (unreadOnly) setNext(null);
      announce();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось отметить уведомления.')));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Прочитанные уходят из списка (и колокольчика) — в выбранной группе или
   * все. Сервер их не удаляет: история входов нужна сотруднику при
   * восстановлении доступа.
   */
  async function clearRead() {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ removed: number; at: string | null }>(
        `/notifications/clear-read${group ? `?group=${encodeURIComponent(group)}` : ''}`,
        { method: 'POST' },
      );
      setItems((prev) => (prev ?? []).filter((n) => !n.readAt));
      setRead(0);
      setConfirming(false);
      setDone(r);
      announce();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось убрать уведомления.')));
    } finally {
      setBusy(false);
    }
  }

  /** «Вернуть» сразу после «Убрать»: та же пачка снова в списке — перечитываем его. */
  async function restore(at: string) {
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ restored: number }>(
        `/notifications/restore?at=${encodeURIComponent(at)}`,
        { method: 'POST' },
      );
      show(await apiFetch<Page>(query()));
      setDone(r);
      announce();
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось вернуть уведомления.')));
    } finally {
      setBusy(false);
    }
  }

  function open(n: Notif) {
    if (n.readAt) return;
    // Переход не ждёт ответа: отметка уходит в фоне.
    void apiFetch(`/notifications/${n.id}/read`, { method: 'POST' })
      .then(announce)
      .catch(() => {});
  }

  const count = (key: string) => (key ? unread?.groups[key] : unread?.total) ?? 0;
  const pending = count(group);
  const now = new Date();

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Уведомления')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t('Всё, что происходило со сделками, спорами и аккаунтом. Сообщения — в «Сообщениях».')}{' '}
          <Link href="/cabinet/settings#notifications">{t('Настроить уведомления')}</Link>
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row notif-groups" role="group" aria-label={t('Группы уведомлений')}>
          {[{ key: '', label: '' }, ...GROUPS].map((g) => (
            <button
              key={g.key || 'all'}
              type="button"
              className="chip"
              aria-pressed={group === g.key}
              onClick={() => setFilter(g.key, unreadOnly)}
            >
              {g.key ? t.d(g.label) : t('Все')}
              {count(g.key) > 0 && <span className="notif-group-count">{count(g.key)}</span>}
            </button>
          ))}
        </div>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <label className="row" style={{ gap: 8, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setFilter(group, e.target.checked)}
            />
            {t('Только непрочитанные')}
          </label>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {pending > 0 && (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void readAll()}
              >
                {group ? t('Прочитать все в группе') : t('Прочитать все')}
              </button>
            )}
            {read > 0 && !unreadOnly && !confirming && (
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => {
                  setDone(null);
                  setConfirming(true);
                }}
              >
                {t('Убрать прочитанные')}
              </button>
            )}
          </div>
        </div>
        {confirming && (
          <div
            className="card flat row notif-confirm"
            role="group"
            aria-label={t('Убрать прочитанные')}
          >
            <span>
              {group
                ? t('Убрать из списка прочитанные уведомления этой группы ({n})?', { n: read })
                : t('Убрать из списка все прочитанные уведомления ({n})?', { n: read })}
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void clearRead()}
              >
                {t('Убрать')}
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                {t('Отмена')}
              </button>
            </span>
          </div>
        )}
        {done && (
          <div className="row" style={{ gap: 12, fontSize: 13 }}>
            <span className="faint" role="status">
              {'restored' in done
                ? t('Вернули в список: {n}', { n: done.restored })
                : t('Убрано из списка: {n}', { n: done.removed })}
            </span>
            {'at' in done && done.at && (
              <button
                type="button"
                className="link-button notif-undo"
                disabled={busy}
                onClick={() => void restore(done.at!)}
              >
                {t('Вернуть')}
              </button>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {items === null ? (
        !err && <div className="skeleton" style={{ height: 320 }} aria-busy="true" />
      ) : items.length === 0 ? (
        <div className="card flat empty-state">
          <p className="muted" style={{ maxWidth: '60ch', margin: 0 }}>
            {unreadOnly
              ? t('Непрочитанных уведомлений нет.')
              : group
                ? t('В этой группе уведомлений пока нет.')
                : t(
                    'Уведомлений пока нет. Здесь появятся оплаты, выдачи, споры, отзывы и всё, что касается аккаунта.',
                  )}
          </p>
        </div>
      ) : (
        <div className="stack" style={{ gap: 24 }}>
          {days(items, now, t).map((d) => (
            <section key={d.label} className="notif-day" aria-label={d.label}>
              <h2 className="notif-day-title">{d.label}</h2>
              <div className="card notif-list">
                {d.items.map((n) => {
                  const g = GROUPS.find((x) => x.key === notifyGroupOf(n.type));
                  const preview =
                    typeof n.payload?.preview === 'string' ? noteText(t, n.payload.preview) : null;
                  return (
                    <Link
                      key={n.id}
                      href={notifyLink(n.type, n.payload)}
                      className={`notif-row${n.readAt ? '' : ' unread'}`}
                      onClick={() => open(n)}
                    >
                      <span className="notif-dot" aria-hidden />
                      <span className="notif-body">
                        <span className="notif-title">
                          {NOTIFY_LABELS[n.type] ? t.d(NOTIFY_LABELS[n.type]) : t('Уведомление')}
                          {!n.readAt && <span className="sr-only"> · {t('не прочитано')}</span>}
                        </span>
                        {preview && <span className="notif-preview">{preview}</span>}
                      </span>
                      <span className="notif-meta">
                        {g && <span className="notif-group">{t.d(g.label)}</span>}
                        <time dateTime={n.createdAt} className="notif-time">
                          {new Date(n.createdAt).toLocaleTimeString(t.locale, {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </time>
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
          {next && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void more()}
              style={{ alignSelf: 'center' }}
            >
              {busy ? '…' : t('Показать ещё')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <NotificationsInner />
    </Suspense>
  );
}
