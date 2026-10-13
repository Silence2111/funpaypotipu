'use client';

import { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { NOTIFY_GROUPS, type NotifyChannel } from '@gamemarket/shared/notify';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

interface Settings {
  prefs: Record<NotifyChannel, Record<string, boolean>>;
  locked: Partial<Record<NotifyChannel, string[]>>;
  email: { address: string | null };
  telegram: { available: boolean; linked: boolean; bot: string | null };
}

const CHANNELS: Array<{ key: NotifyChannel; label: string }> = [
  { key: 'email', label: 'Почта' },
  { key: 'telegram', label: 'Telegram' },
];

/**
 * Куда приходят уведомления: на сайте — всегда, письмом и в Telegram — по
 * группам. Telegram подключается ботом: ссылка открывает его с кодом.
 */
export function NotificationSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  const load = useCallback(async () => {
    setS(await apiFetch<Settings>('/account/notifications'));
  }, []);

  useEffect(() => {
    load().catch(() => setErr('Не удалось загрузить настройки уведомлений'));
  }, [load]);

  // После перехода в Telegram ждём, пока бот привяжет чат: страница узнаёт сама.
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      apiFetch<Settings>('/account/notifications')
        .then((next) => {
          setS(next);
          if (next.telegram.linked) setWaiting(false);
        })
        .catch(() => {});
    }, 3000);
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waiting]);

  async function toggle(channel: NotifyChannel, group: string, value: boolean) {
    if (!s) return;
    setS({ ...s, prefs: { ...s.prefs, [channel]: { ...s.prefs[channel], [group]: value } } });
    try {
      setS(await apiFetch<Settings>('/account/notifications', {
        method: 'PATCH',
        body: JSON.stringify({ [channel]: { [group]: value } }),
      }));
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить настройку.'));
      void load();
    }
  }

  async function connect() {
    setBusy(true);
    setErr(null);
    try {
      const { url } = await apiFetch<{ url: string }>('/account/telegram/link', { method: 'POST' });
      window.open(url, '_blank', 'noopener');
      setWaiting(true);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось получить ссылку на бота.'));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      setS(await apiFetch<Settings>('/account/telegram', { method: 'DELETE' }));
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось отключить Telegram.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="notifications" style={{ maxWidth: 600, scrollMarginTop: 80 }}>
      <h2 className="h2" style={{ fontSize: 18, marginBottom: 6 }}>Уведомления</h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
        На сайте — всегда. Письмом и в Telegram — по вашему выбору.
      </p>
      {err && <p className="field-error" role="alert">{err}</p>}
      {!s ? (
        <div className="skeleton" style={{ height: 160 }} aria-busy="true" />
      ) : (
        <div className="card" style={{ padding: 20 }}>
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingBottom: 14, borderBottom: '1px solid var(--border)' }}>
            <span className="row" style={{ gap: 8 }}>
              <Send size={18} strokeWidth={1.75} />
              <span>
                <span style={{ fontWeight: 600 }}>Telegram</span>
                <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                  {!s.telegram.available
                    ? 'Бот на стенде не подключён'
                    : s.telegram.linked
                      ? `Подключён${s.telegram.bot ? ` · @${s.telegram.bot}` : ''}`
                      : waiting
                        ? 'Откройте бота и нажмите «Старт» — страница обновится сама'
                        : 'Мгновенные уведомления о заказах и сообщениях'}
                </span>
              </span>
            </span>
            {s.telegram.available &&
              (s.telegram.linked ? (
                <button type="button" className="chip" disabled={busy} onClick={() => void disconnect()}>Отключить</button>
              ) : (
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void connect()}>
                  Подключить Telegram
                </button>
              ))}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontWeight: 500, padding: '8px 0' }} className="faint">Что</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} style={{ width: 84, fontWeight: 500 }} className="faint">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFY_GROUPS.map((g) => (
                <tr key={g.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontWeight: 600 }}>{g.label}</span>
                    <span className="faint" style={{ display: 'block', fontSize: 12 }}>{g.hint}</span>
                  </td>
                  {CHANNELS.map((c) => {
                    const locked = !!s.locked[c.key]?.includes(g.key);
                    const off =
                      locked || (c.key === 'telegram' && !s.telegram.linked) || (c.key === 'email' && !s.email.address);
                    return (
                      <td key={c.key} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`${g.label} — ${c.label}`}
                          checked={locked || !!s.prefs[c.key][g.key]}
                          disabled={off}
                          onChange={(e) => void toggle(c.key, g.key, e.target.checked)}
                          style={{ width: 18, height: 18, accentColor: 'var(--accent)' }}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
