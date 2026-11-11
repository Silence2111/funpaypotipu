'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  lastUsedAt: string | null;
  createdAt: string;
}
interface Delivery {
  id: string;
  event: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  responseCode: number | null;
  error: string | null;
  createdAt: string;
}
interface RequestRow {
  id: string;
  method: string;
  path: string;
  status: number;
  createdAt: string;
  key: { name: string };
}

/**
 * API для продавцов в «Инструментах» (часть 127): ключи (показываются один
 * раз), вебхук «оплачен новый заказ» с секретом для подписи, последние
 * доставки и запросы. Документация — /prodavat/api.
 */
export function SellerApi() {
  const t = useT();
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [hook, setHook] = useState<{ url: string | null; deliveries: Delivery[] } | null>(null);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [fresh, setFresh] = useState<{ label: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const [k, h, r] = await Promise.all([
      apiFetch<ApiKeyRow[]>('/account/api/keys'),
      apiFetch<{ url: string | null; deliveries: Delivery[] }>('/account/api/webhook'),
      apiFetch<RequestRow[]>('/account/api/requests'),
    ]);
    setKeys(k);
    setHook(h);
    setRequests(r.slice(0, 10));
    setUrl((u) => u || h.url || '');
  }, []);

  useEffect(() => {
    load().catch(() => setMsg({ ok: false, text: t('Не удалось загрузить настройки API.') }));
  }, [load, t]);

  async function run(fn: () => Promise<void>, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fallback) });
    } finally {
      setBusy(false);
    }
  }

  const date = (iso: string) => new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  return (
    <section className="card tools-card" aria-labelledby="api-title">
      <h2 className="h2 tools-title" id="api-title">{t('API')}</h2>
      <p className="muted tools-text">
        {t('Свой бот или склад: цены и наличие лотов, загрузка товара для автовыдачи, заказы и отметка выдачи — по ключу, без пароля от аккаунта.')}{' '}
        <Link href="/prodavat/api" style={{ color: 'var(--accent)' }}>{t('Документация')}</Link>
      </p>

      {msg && <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      {fresh && (
        <div className="alert success" role="status" style={{ display: 'grid', gap: 6 }}>
          <span>{fresh.label}</span>
          <code style={{ wordBreak: 'break-all', userSelect: 'all' }}>{fresh.value}</code>
          <span className="hint" style={{ margin: 0 }}>{t('Скопируйте сейчас: больше мы его не покажем.')}</span>
        </div>
      )}

      <h3 style={{ fontSize: 15, margin: '8px 0 4px' }}>{t('Ключи')}</h3>
      {keys && keys.length > 0 ? (
        <ul className="tools-templates">
          {keys.map((k) => (
            <li key={k.id} className="tools-template">
              <div className="tools-template-main">
                <div className="tools-template-title">{k.name}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  <code>{k.prefix}…</code> · {k.lastUsedAt ? t('последний запрос {date}', { date: date(k.lastUsedAt) }) : t('ещё не использовался')}
                </div>
              </div>
              <button type="button" className="chip" disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('Отозвать ключ «{name}»? Запросы с ним сразу перестанут работать.', { name: k.name }))) return;
                  void run(async () => { await apiFetch(`/account/api/keys/${k.id}`, { method: 'DELETE' }); }, t('Не удалось отозвать ключ.'));
                }}>
                {t('Отозвать')}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        keys && <p className="hint" style={{ margin: 0 }}>{t('Ключей пока нет.')}</p>
      )}
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => {
            const r = await apiFetch<{ key: string }>('/account/api/keys', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
            setFresh({ label: t('Новый ключ API:'), value: r.key });
            setName('');
          }, t('Не удалось выпустить ключ.'));
        }}>
        <div className="field" style={{ flex: 1, minWidth: 200 }}>
          <label className="label" htmlFor="api-key-name">{t('Название ключа')}</label>
          <input id="api-key-name" className="input" maxLength={60} placeholder={t('Например, бот склада')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy || !name.trim()}>{t('Выпустить ключ')}</button>
      </form>

      <h3 style={{ fontSize: 15, margin: '16px 0 4px' }}>{t('Вебхук «оплачен новый заказ»')}</h3>
      <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void run(async () => {
            const r = await apiFetch<{ secret: string }>('/account/api/webhook', { method: 'PUT', body: JSON.stringify({ url: url.trim() }) });
            setFresh({ label: t('Секрет для проверки подписи вебхука:'), value: r.secret });
          }, t('Не удалось сохранить вебхук.'));
        }}>
        <div className="field" style={{ flex: 1, minWidth: 220 }}>
          <label className="label" htmlFor="api-webhook">{t('Адрес (https)')}</label>
          <input id="api-webhook" className="input" type="url" placeholder="https://example.com/gamemarket" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy || !url.trim()}>{hook?.url ? t('Сменить') : t('Сохранить')}</button>
      </form>
      {hook?.url && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className="chip" disabled={busy}
            onClick={() => void run(async () => {
              await apiFetch('/account/api/webhook/test', { method: 'POST' });
              setMsg({ ok: true, text: t('Проверочное событие отправлено — результат ниже через несколько секунд.') });
            }, t('Не удалось отправить проверку.'))}>
            {t('Проверить')}
          </button>
          <button type="button" className="chip" disabled={busy}
            onClick={() => void run(async () => { await apiFetch('/account/api/webhook', { method: 'DELETE' }); setUrl(''); }, t('Не удалось убрать вебхук.'))}>
            {t('Убрать')}
          </button>
        </div>
      )}
      {hook && hook.deliveries.length > 0 && (
        <ul className="hint" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {hook.deliveries.slice(0, 5).map((d) => (
            <li key={d.id}>
              {date(d.createdAt)} · {d.event} ·{' '}
              {d.status === 'delivered' ? t('доставлено') : d.status === 'failed' ? t('не доставлено') : t('повтор')}
              {d.error ? ` · ${d.error}` : ''}
            </li>
          ))}
        </ul>
      )}

      {requests.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: '16px 0 4px' }}>{t('Последние запросы')}</h3>
          <ul className="hint" style={{ margin: 0, paddingLeft: 18 }}>
            {requests.map((r) => (
              <li key={r.id}>
                {date(r.createdAt)} · <code>{r.method} {r.path}</code> · {r.status} · {r.key.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
