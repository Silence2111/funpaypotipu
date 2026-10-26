'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

const REASONS = [
  {
    v: 'two_factor',
    t: msg('Вход с кодом включил не я'),
    d: msg('Пароль сменили, а потом включили вход с кодом — «Это не я» из писем не помогает'),
  },
  { v: 'password', t: msg('Пароль сменил не я'), d: msg('Ссылка «Это не я» из письма истекла или не пришла') },
  { v: 'other', t: msg('Другое'), d: msg('Опишите, что случилось') },
] as const;

/**
 * «Не могу войти»: заявка сотруднику, когда «Это не я» из писем не помогло.
 * Ответ всегда один — по нему не узнать, есть ли аккаунт. Решение — не
 * раньше чем через 3 дня, ответ — только на почту аккаунта.
 */
export default function RecoverPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [reason, setReason] = useState<(typeof REASONS)[number]['v']>('two_factor');
  const [orders, setOrders] = useState('');
  const [details, setDetails] = useState('');
  // Нет доступа и к почте аккаунта: ответ — на новую почту, нужна проверка личности.
  const [noMail, setNoMail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (details.trim().length < 10) { setErr(t('Опишите, что случилось, — от 10 символов')); return; }
    const orderNumbers = orders.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (orderNumbers.length > 3) { setErr(t('Не больше трёх номеров заказов')); return; }
    if (noMail && !newEmail.trim()) { setErr(t('Укажите почту, на которую ответить')); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/recovery', {
        method: 'POST',
        body: JSON.stringify({ email, reason, orderNumbers, details, ...(noMail ? { newEmail } : {}) }),
      });
      setSent(true);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось отправить заявку. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Не могу войти')}</h1>
      {sent ? (
        <div className="stack-form">
          <p role="status" style={{ margin: 0 }}>{t('Заявка принята.')}</p>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {noMail
              ? t('Если аккаунт с такой почтой есть и проверка личности у него пройдена, сотрудник напишет на новую почту и попросит фото документа и селфи с ним. Решение — не раньше чем через 3 дня.')
              : t('Если аккаунт с такой почтой есть, сотрудник проверит, что он ваш, и ответит на почту аккаунта. Решение — не раньше чем через 3 дня: за это время владелец аккаунта увидит заявку и сможет сказать, что подавал её не он.')}
          </p>
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
            {t('Когда «Это не я» из писем не помогло. Сотрудник сверит заявку с историей аккаунта: сделки, входы, смены пароля.')}
          </p>
          <form onSubmit={submit} className="stack-form">
            <div className="field">
              <label className="label" htmlFor="rc-email">{t('Почта аккаунта')}</label>
              <input id="rc-email" className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
                value={email} required onChange={(e) => setEmail(e.target.value)} />
            </div>
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{t('Что случилось')}</legend>
              {REASONS.map((o) => (
                <label key={o.v} className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
                  <input type="radio" name="reason" checked={reason === o.v} onChange={() => setReason(o.v)}
                    style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--accent)' }} />
                  <span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{t(o.t)}</span>
                    <span className="hint" style={{ display: 'block' }}>{t(o.d)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="row" style={{ gap: 10, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={noMail} onChange={(e) => setNoMail(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0, accentColor: 'var(--accent)' }} />
              <span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{t('Нет доступа и к почте аккаунта')}</span>
                <span className="hint" style={{ display: 'block' }}>
                  {t('Только если у аккаунта пройдена проверка личности: сотрудник попросит селфи с тем же документом.')}
                </span>
              </span>
            </label>
            {noMail && (
              <div className="field">
                <label className="label" htmlFor="rc-new-email">{t('Новая почта для связи')}</label>
                <input id="rc-new-email" className="input" type="email" autoComplete="email" autoCapitalize="none"
                  spellCheck={false} value={newEmail} required onChange={(e) => setNewEmail(e.target.value)} />
                <p className="hint">{t('Если сотрудник подтвердит, что аккаунт ваш, она станет почтой аккаунта.')}</p>
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="rc-orders">{t('Номера заказов — необязательно')}</label>
              <input id="rc-orders" className="input" autoCapitalize="characters" spellCheck={false}
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                placeholder="GM-…" value={orders} onChange={(e) => setOrders(e.target.value)} />
              <p className="hint">{t('До трёх, через запятую. Подтверждают, что сделки — ваши.')}</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="rc-details">{t('Подробности')}</label>
              <textarea id="rc-details" className="input" rows={4} maxLength={2000} value={details} required
                placeholder={t('Когда перестали входить, что пришло на почту, с чего обычно входите')}
                onChange={(e) => setDetails(e.target.value)} />
            </div>
            {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{err}</p>}
            <button className="btn" type="submit" disabled={busy || !email} style={{ width: '100%' }}>
              {busy ? '…' : t('Отправить заявку')}
            </button>
          </form>
        </>
      )}
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        <Link href="/login">{t('← Ко входу')}</Link>
      </p>
    </div>
  );
}
