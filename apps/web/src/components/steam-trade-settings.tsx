'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { STEAM_TRADE_LABEL, isSteamTradeUrl } from '@gamemarket/shared/buyer-data';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * Ссылка на обмен Steam в настройках (часть 142). Запоминается сама при
 * заказе скина, здесь её можно вписать заранее, поменять или стереть —
 * подставляется в каждый следующий заказ с таким полем.
 */
export function SteamTradeSettings() {
  const t = useT();
  const [saved, setSaved] = useState<string | null | undefined>(undefined);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ url: string | null }>('/account/steam-trade')
      .then((r) => {
        setSaved(r.url);
        setUrl(r.url ?? '');
      })
      .catch(() => setSaved(null));
  }, []);

  const value = url.trim();
  const bad = value.length > 0 && !isSteamTradeUrl(value);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (bad) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ url: string | null }>('/account/steam-trade', { method: 'PUT', body: JSON.stringify({ url: value }) });
      setSaved(r.url);
      setMsg({ ok: true, text: r.url ? t('Сохранили — подставим в следующий заказ.') : t('Ссылку стёрли.') });
    } catch (err) {
      setMsg({ ok: false, text: apiErrorMessage(err, t('Не удалось сохранить.')) });
    } finally {
      setBusy(false);
    }
  }

  if (saved === undefined) return <div className="skeleton" style={{ height: 120, maxWidth: 600 }} aria-busy="true" />;

  return (
    <form onSubmit={save} className="card stack-form" style={{ padding: 24, gap: 12, maxWidth: 600 }}>
      <div className="field" style={{ margin: 0 }}>
        <label className="label" htmlFor="steam-trade">{t.d(STEAM_TRADE_LABEL)}</label>
        <input id="steam-trade" className="input" type="url" inputMode="url" maxLength={100} value={url}
          placeholder="https://steamcommunity.com/tradeoffer/new/?partner=…&token=…"
          autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-invalid={bad || undefined}
          onChange={(e) => {
            setUrl(e.target.value);
            setMsg(null);
          }} />
        {bad ? (
          <p className="field-error">{t('Ссылка вида https://steamcommunity.com/tradeoffer/new/?partner=…&token=…')}</p>
        ) : (
          <p className="hint">
            {t('Для скинов и предметов Steam: подставим в заказ сами. Где взять: Steam → Инвентарь → Предложения обмена → «Кто может отправлять мне предложения».')}
          </p>
        )}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`} role={msg.ok ? 'status' : 'alert'}>{msg.text}</div>}
      <div>
        <button className="btn" type="submit" disabled={busy || bad || value === (saved ?? '')}>
          {busy ? t('Сохраняем…') : t('Сохранить')}
        </button>
      </div>
    </form>
  );
}
