'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface Status {
  email: string;
  until: string;
}

/**
 * «Это не я» из письма на прежнюю почту: вернуть её и задать новый пароль.
 * Сменивший почту знал пароль и мог завести вход с кодом и сервисы входа —
 * всё это снимается, все устройства выходят.
 */
function RevertInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [status, setStatus] = useState<Status | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return setInvalid(true);
    apiFetch<Status>('/auth/email/revert/status', { method: 'POST', body: JSON.stringify({ token }) })
      .then(setStatus)
      .catch(() => setInvalid(true));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setErr(t('Новый пароль — от 8 символов'));
    setBusy(true);
    setErr(null);
    try {
      const r = await apiFetch<{ email: string }>('/auth/email/revert', {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(r.email);
    } catch (e2) {
      setErr(apiErrorMessage(e2, t('Не удалось вернуть почту. Попробуйте ещё раз.')));
      setBusy(false);
    }
  }

  const until = status
    ? new Date(status.until).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div style={{ maxWidth: 440, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Вернуть прежнюю почту')}</h1>
      {done ? (
        <div className="stack-form">
          <p role="status" style={{ margin: 0 }}>
            {t('Почта аккаунта снова {email}. Все устройства вышли, вход с кодом и входы через сервисы отключены.', { email: done })}
          </p>
          <Link href="/login" className="btn" style={{ width: '100%' }}>{t('Войти с новым паролем')}</Link>
        </div>
      ) : invalid ? (
        <div className="stack-form">
          <p role="alert" style={{ margin: 0 }}>{t('Ссылка недействительна или истекла')}</p>
          <p className="muted" style={{ fontSize: 14, margin: 0 }}>
            {t('Вернуть почту можно 7 дней после смены и только до следующей смены. Если доступа к аккаунту нет — «Не могу войти».')}
          </p>
          <Link href="/recover">{t('Не могу войти')}</Link>
        </div>
      ) : !status ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
            {t('Почту аккаунта сменили на {email}. Если это сделали не вы — верните прежнюю до {until}: задайте новый пароль, все устройства выйдут, вход с кодом и входы через сервисы отключатся.', {
              email: status.email,
              until,
            })}
          </p>
          <form onSubmit={submit} className="stack-form">
            <div className="field">
              <label className="label" htmlFor="rv-next">{t('Новый пароль')}</label>
              <input id="rv-next" className="input" type="password" autoComplete="new-password" value={password} required
                onChange={(e) => setPassword(e.target.value)} />
              <p className="hint">{t('От 8 символов.')}</p>
            </div>
            {err && <p role="alert" style={{ color: 'var(--danger)', fontSize: 14, margin: 0 }}>{err}</p>}
            <button className="btn" type="submit" disabled={busy || !password} style={{ width: '100%' }}>
              {busy ? '…' : t('Вернуть почту')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function EmailRevertPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <RevertInner />
    </Suspense>
  );
}
