'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Smartphone } from 'lucide-react';
import { formatPhone, normalizeRuPhone } from '@gamemarket/shared/phone';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage, errorBody } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface PhoneStatus {
  phone: string | null;
  enabled: boolean;
}

/**
 * Номер телефона в «Безопасности» (часть 121): привязать по коду из SMS,
 * сменить, отвязать. Номер — ещё один способ войти и вернуть доступ:
 * забыли пароль — вошли по номеру и задали новый.
 */
export function PhoneCard() {
  const t = useT();
  const [s, setS] = useState<PhoneStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<PhoneStatus>('/account/phone').then(setS).catch(() => {});
  }, []);

  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (!normalizeRuPhone(phone)) return setNote({ ok: false, text: t('Номер — российский мобильный: +7 9XX XXX-XX-XX') });
    setBusy(true);
    setNote(null);
    try {
      const r = await apiFetch<{ sentTo: string; retryIn: number }>('/account/phone/start', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setSentTo(r.sentTo);
      setWait(r.retryIn);
    } catch (err) {
      const body = errorBody(err) as { error?: string; retryIn?: number } | null;
      if (body?.error === 'phone_code_wait' && body.retryIn) setWait(body.retryIn);
      setNote({ ok: false, text: apiErrorMessage(err, t('Не удалось отправить код. Попробуйте ещё раз.')) });
    } finally {
      setBusy(false);
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      const next = await apiFetch<PhoneStatus>('/account/phone', {
        method: 'POST',
        body: JSON.stringify({ phone, code: code.trim() }),
      });
      setS(next);
      setEditing(false);
      setSentTo(null);
      setCode('');
      setNote({ ok: true, text: t('Номер привязан — теперь по нему можно войти.') });
    } catch (err) {
      setNote({ ok: false, text: apiErrorMessage(err, t('Код не подошёл')) });
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    if (!window.confirm(t('Отвязать номер? Войти по нему больше не получится.'))) return;
    setBusy(true);
    setNote(null);
    try {
      setS(await apiFetch<PhoneStatus>('/account/phone', { method: 'DELETE' }));
      setNote({ ok: true, text: t('Номер отвязан.') });
    } catch (err) {
      setNote({ ok: false, text: apiErrorMessage(err, t('Не получилось отвязать номер.')) });
    } finally {
      setBusy(false);
    }
  }

  if (!s || (!s.enabled && !s.phone)) return null;

  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }} aria-labelledby="phone-title">
      <h2 className="h2 row" id="phone-title" style={{ fontSize: 18, gap: 8 }}>
        <Smartphone size={18} strokeWidth={1.75} /> {t('Номер телефона')}
      </h2>
      <p className="muted" style={{ margin: '6px 0 12px', fontSize: 14 }}>
        {t('Ещё один способ войти и вернуть доступ: забыли пароль — войдите по номеру, код придёт в SMS.')}
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        <p style={{ margin: 0 }}>
          {s.phone ? <b>{formatPhone(s.phone)}</b> : <span className="faint">{t('Номер не привязан')}</span>}
        </p>
        {note && (
          <div className={note.ok ? 'alert success' : 'alert error'} role={note.ok ? 'status' : 'alert'}>
            {note.text}
          </div>
        )}
        {editing ? (
          sentTo ? (
            <form className="stack-form" style={{ gap: 10 }} onSubmit={confirm}>
              <div className="field">
                <label className="label" htmlFor="phone-code">{t('Код из SMS на {phone}', { phone: sentTo })}</label>
                <input id="phone-code" className="input" value={code} onChange={(e) => setCode(e.target.value)}
                  inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" autoFocus />
                <p className="hint">
                  {wait > 0 ? (
                    t('Новый код — через {n} сек.', { n: wait })
                  ) : (
                    <button type="button" className="link-button" disabled={busy} onClick={() => void send()}>
                      {t('Отправить код ещё раз')}
                    </button>
                  )}
                </p>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>{t('Привязать')}</button>
                <button className="chip" type="button" onClick={() => { setEditing(false); setSentTo(null); }}>{t('Отмена')}</button>
              </div>
            </form>
          ) : (
            <form className="stack-form" style={{ gap: 10 }} onSubmit={send}>
              <div className="field">
                <label className="label" htmlFor="phone-new">{t('Российский мобильный номер')}</label>
                <input id="phone-new" className="input" type="tel" inputMode="tel" autoComplete="tel"
                  placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} autoFocus />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn" type="submit" disabled={busy}>{t('Получить код')}</button>
                <button className="chip" type="button" onClick={() => setEditing(false)}>{t('Отмена')}</button>
              </div>
            </form>
          )
        ) : (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {s.enabled && (
              <button type="button" className="chip" onClick={() => { setEditing(true); setNote(null); setPhone(''); }}>
                {s.phone ? t('Сменить номер') : t('Привязать номер')}
              </button>
            )}
            {s.phone && (
              <button type="button" className="chip" disabled={busy} onClick={() => void unlink()}>
                {t('Отвязать')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
