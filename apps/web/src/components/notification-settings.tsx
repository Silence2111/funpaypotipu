'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Send } from 'lucide-react';
import { NOTIFY_GROUPS, type NotifyChannel } from '@gamemarket/shared/notify';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { disablePush, enablePush, pushHere, type PushHere } from '@/lib/push';
import { useT } from '@/lib/i18n/client';
import { LANG_NAMES, isLang, msg, type T } from '@/lib/i18n/lang';

interface Settings {
  prefs: Record<NotifyChannel, Record<string, boolean>>;
  locked: Partial<Record<NotifyChannel, string[]>>;
  email: { address: string | null };
  telegram: { available: boolean; linked: boolean; bot: string | null };
  push: { available: boolean; publicKey: string | null; devices: number };
  /** Язык писем, Telegram и пушей. */
  locale?: string;
}

const CHANNELS: Array<{ key: NotifyChannel; label: string }> = [
  { key: 'email', label: msg('Почта') },
  { key: 'telegram', label: 'Telegram' },
  { key: 'push', label: msg('Пуш') },
];

/** Подпись под «Пуш-уведомления»: что с ними на этом устройстве и на других. */
function pushStatus(here: PushHere | null, devices: number, available: boolean, t: T): string {
  if (!available) return t('На стенде выключены');
  const elsewhere = here === 'on' ? devices - 1 : devices;
  const others = elsewhere > 0 ? t(' · ещё устройств: {n}', { n: elsewhere }) : '';
  switch (here) {
    case 'on':
      return t('Включены на этом устройстве') + others;
    case 'denied':
      return t('Уведомления для сайта запрещены в настройках браузера') + others;
    case 'install':
      return t('На iPhone — после установки сайта: «Поделиться» → «На экран Домой»') + others;
    case 'unsupported':
      return t('Этот браузер пуши не принимает') + others;
    default:
      return elsewhere > 0
        ? t('Включены на других устройствах: {n}', { n: elsewhere })
        : t('Заказы и сообщения — сразу на экран, даже когда сайт закрыт');
  }
}

/**
 * Куда приходят уведомления: на сайте — всегда, письмом, в Telegram и пушем —
 * по группам. Telegram подключается ботом: ссылка открывает его с кодом.
 * Пуши — на устройство: включаются здесь, в каждом браузере отдельно.
 */
export function NotificationSettings() {
  const t = useT();
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [here, setHere] = useState<PushHere | null>(null);

  const load = useCallback(async () => {
    setS(await apiFetch<Settings>('/account/notifications'));
  }, []);

  useEffect(() => {
    load().catch(() => setErr(t('Не удалось загрузить настройки уведомлений')));
    pushHere()
      .then(setHere)
      .catch(() => setHere('unsupported'));
  }, [load, t]);

  // Язык сменили переключателем — строка о языке писем меняется сразу.
  useEffect(() => {
    const onLocale = (e: Event) => {
      const locale = (e as CustomEvent<string>).detail;
      setS((prev) => (prev ? { ...prev, locale } : prev));
    };
    window.addEventListener('gm-locale', onLocale);
    return () => window.removeEventListener('gm-locale', onLocale);
  }, []);

  // После перехода в Telegram ждём, пока бот привяжет чат: страница узнаёт сама.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      apiFetch<Settings>('/account/notifications')
        .then((next) => {
          setS(next);
          if (next.telegram.linked) setWaiting(false);
        })
        .catch(() => {});
    }, 3000);
    const stop = setTimeout(() => setWaiting(false), 5 * 60_000);
    return () => {
      clearInterval(timer);
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
      setErr(apiErrorMessage(e, t('Не удалось сохранить настройку.')));
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
      setErr(apiErrorMessage(e, t('Не удалось получить ссылку на бота.')));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    try {
      setS(await apiFetch<Settings>('/account/telegram', { method: 'DELETE' }));
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось отключить Telegram.')));
    } finally {
      setBusy(false);
    }
  }

  async function togglePush(on: boolean) {
    if (!s?.push.publicKey) return;
    setBusy(true);
    setErr(null);
    try {
      if (on) setHere(await enablePush(s.push.publicKey));
      else {
        await disablePush();
        setHere('off');
      }
      await load();
    } catch (e) {
      setErr(
        apiErrorMessage(e, on ? t('Не удалось включить пуши на этом устройстве.') : t('Не удалось выключить пуши.')),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="notifications" style={{ maxWidth: 600, scrollMarginTop: 80 }}>
      <h2 className="h2" style={{ fontSize: 18, marginBottom: 6 }}>{t('Уведомления')}</h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
        {t('На сайте — всегда. Письмом, в Telegram и пушем — по вашему выбору.')}
      </p>
      {s && isLang(s.locale) && (
        <p className="faint" style={{ margin: '-4px 0 12px', fontSize: 13 }}>
          {t('Письма, Telegram и пуши приходят на языке: {lang}. Он меняется вместе с языком сайта.', {
            lang: LANG_NAMES[s.locale],
          })}
        </p>
      )}
      {err && <p className="field-error" role="alert">{err}</p>}
      {!s ? (
        <div className="skeleton" style={{ height: 160 }} aria-busy="true" />
      ) : (
        <div className="card" style={{ padding: 20 }}>
          <div className="notify-channel">
            <span className="row" style={{ gap: 8 }}>
              <Send size={18} strokeWidth={1.75} />
              <span>
                <span style={{ fontWeight: 600 }}>Telegram</span>
                <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                  {!s.telegram.available
                    ? t('Бот на стенде не подключён')
                    : s.telegram.linked
                      ? `${t('Подключён')}${s.telegram.bot ? ` · @${s.telegram.bot}` : ''}`
                      : waiting
                        ? t('Откройте бота и нажмите «Старт» — страница обновится сама')
                        : t('Мгновенные уведомления о заказах и сообщениях')}
                </span>
              </span>
            </span>
            {s.telegram.available &&
              (s.telegram.linked ? (
                <button type="button" className="chip" disabled={busy} onClick={() => void disconnect()}>{t('Отключить')}</button>
              ) : (
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void connect()}>
                  {t('Подключить Telegram')}
                </button>
              ))}
          </div>

          <div className="notify-channel">
            <span className="row" style={{ gap: 8 }}>
              <BellRing size={18} strokeWidth={1.75} />
              <span>
                <span style={{ fontWeight: 600 }}>{t('Пуш-уведомления')}</span>
                <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                  {pushStatus(here, s.push.devices, s.push.available, t)}
                </span>
              </span>
            </span>
            {s.push.available &&
              (here === 'on' ? (
                <button type="button" className="chip" disabled={busy} onClick={() => void togglePush(false)}>
                  {t('Выключить')}
                </button>
              ) : here === 'off' ? (
                <button type="button" className="btn secondary" disabled={busy} onClick={() => void togglePush(true)}>
                  {t('Включить на этом устройстве')}
                </button>
              ) : null)}
          </div>

          <table className="notify-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', fontWeight: 500, padding: '8px 0' }} className="faint">{t('Что')}</th>
                {CHANNELS.map((c) => (
                  <th key={c.key} className="faint notify-col">{t(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFY_GROUPS.map((g) => (
                <tr key={g.key} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span style={{ fontWeight: 600 }}>{t.d(g.label)}</span>
                    <span className="faint" style={{ display: 'block', fontSize: 12 }}>{t.d(g.hint)}</span>
                  </td>
                  {CHANNELS.map((c) => {
                    const locked = !!s.locked[c.key]?.includes(g.key);
                    const off =
                      locked ||
                      (c.key === 'telegram' && !s.telegram.linked) ||
                      (c.key === 'email' && !s.email.address) ||
                      (c.key === 'push' && !s.push.devices);
                    return (
                      <td key={c.key} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label={`${t.d(g.label)} — ${t(c.label)}`}
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
