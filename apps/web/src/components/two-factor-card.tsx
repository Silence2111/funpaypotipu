'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Download, ShieldCheck } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface Status {
  enabled: boolean;
  recoveryLeft: number;
}

/**
 * Двухфакторная защита: QR-код для приложения-аутентификатора, ключ для
 * ручного ввода и резервные коды на случай потерянного телефона. Коды
 * показываются один раз — скопировать или скачать файлом.
 */
export function TwoFactorCard() {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(
    () =>
      apiFetch<Status>('/auth/2fa')
        .then(setStatus)
        .catch(() => setStatus({ enabled: false, recoveryLeft: 0 })),
    [],
  );
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<string | null>, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      const text = await fn();
      if (text) setMsg({ ok: true, text });
      setCode('');
      await load();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fallback) });
    } finally {
      setBusy(false);
    }
  }

  const start = () =>
    act(async () => {
      setSetup(
        await apiFetch<{ secret: string; qrSvg: string }>('/auth/2fa/setup', { method: 'POST' }),
      );
      return null;
    }, t('Не удалось начать подключение.'));

  const enable = () =>
    act(async () => {
      const r = await apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setSetup(null);
      setCodes(r.recoveryCodes);
      return t('Защита включена. Сохраните резервные коды — они понадобятся без телефона.');
    }, t('Код не подошёл.'));

  const regenerate = () =>
    act(async () => {
      const r = await apiFetch<{ recoveryCodes: string[] }>('/auth/2fa/recovery', {
        method: 'POST',
        body: JSON.stringify({ code }),
      });
      setCodes(r.recoveryCodes);
      return t('Новые резервные коды — старые больше не работают.');
    }, t('Код не подошёл.'));

  const disable = () =>
    act(async () => {
      await apiFetch('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) });
      return t('Двухфакторная защита отключена.');
    }, t('Код не подошёл.'));

  function download(list: string[]) {
    const blob = new Blob(
      [`${t('Резервные коды GameMarket — каждый работает один раз')}\n\n${list.join('\n')}\n`],
      {
        type: 'text/plain;charset=utf-8',
      },
    );
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'gamemarket-reserve-codes.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const codeInput = (label: string, placeholder: string) => (
    <input
      className="input"
      style={{ maxWidth: 200 }}
      inputMode="numeric"
      autoComplete="one-time-code"
      placeholder={placeholder}
      aria-label={label}
      value={code}
      onChange={(e) => setCode(e.target.value)}
    />
  );

  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }}>
      <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
        <ShieldCheck size={18} strokeWidth={1.75} /> {t('Двухфакторная защита')}
      </h2>
      <p className="muted" style={{ fontSize: 14, margin: '8px 0 14px' }}>
        {t(
          'При входе, кроме пароля, нужен код из приложения-аутентификатора: Google Authenticator, 1Password и похожих.',
        )}
      </p>

      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
          style={{ marginBottom: 14 }}
        >
          {msg.text}
        </div>
      )}

      {codes ? (
        <div className="stack-form" style={{ gap: 12 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>
            {t('Резервные коды — каждый работает один раз')}
          </p>
          <ol className="reserve-codes">
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ol>
          <p className="hint" style={{ margin: 0 }}>
            {t(
              'Сохраните их там, где нет телефона: в менеджере паролей или на бумаге. Больше мы их не покажем.',
            )}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="chip"
              onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}
            >
              <Copy size={14} strokeWidth={1.75} aria-hidden /> {t('Скопировать')}
            </button>
            <button type="button" className="chip" onClick={() => download(codes)}>
              <Download size={14} strokeWidth={1.75} aria-hidden /> {t('Скачать')}
            </button>
            <button type="button" className="btn secondary" onClick={() => setCodes(null)}>
              {t('Коды сохранены')}
            </button>
          </div>
        </div>
      ) : status === null ? null : status.enabled ? (
        <div className="stack-form" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>
            <span className="badge success">{t('включена')}</span>{' '}
            <span
              className={status.recoveryLeft <= 2 ? 'field-error' : 'faint'}
              style={{ fontSize: 13 }}
            >
              {t('резервных кодов осталось: {n}', { n: status.recoveryLeft })}
            </span>
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {codeInput(t('Код из приложения'), t('Код из приложения'))}
            <button
              type="button"
              className="chip"
              disabled={busy || !code.trim()}
              onClick={() => void regenerate()}
            >
              {t('Новые резервные коды')}
            </button>
            <button
              type="button"
              className="chip"
              disabled={busy || !code.trim()}
              onClick={() => void disable()}
            >
              {t('Отключить защиту')}
            </button>
          </div>
        </div>
      ) : setup ? (
        <div className="two-factor-setup">
          <div
            className="qr"
            aria-label={t('QR-код для приложения')}
            dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
          />
          <div className="stack-form" style={{ gap: 10, minWidth: 0 }}>
            <p style={{ margin: 0 }}>{t('1. Отсканируйте QR-код в приложении-аутентификаторе.')}</p>
            <p className="hint" style={{ margin: 0 }}>
              {t('Не получается — добавьте ключ вручную:')}
            </p>
            <code className="secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            <p style={{ margin: 0 }}>{t('2. Введите шесть цифр, которые покажет приложение.')}</p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              {codeInput(t('Код из приложения'), '123456')}
              <button
                type="button"
                className="btn"
                disabled={busy || !code.trim()}
                onClick={() => void enable()}
              >
                {t('Включить')}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          className="btn secondary"
          type="button"
          disabled={busy}
          onClick={() => void start()}
        >
          {t('Настроить')}
        </button>
      )}
    </section>
  );
}
