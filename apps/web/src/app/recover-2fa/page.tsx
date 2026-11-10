'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Это не я» из письма «Вход с кодом из приложения включён». Ссылки мало:
 * нужен пароль, который был у аккаунта при включении, — его знает владелец,
 * а не тот, кто читает почту. Итог — вход с кодом выключен, пароль новый.
 */
function RecoverInner() {
  const t = useT();
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) { setErr(t('Нет токена в ссылке')); return; }
    if (next.length < 8) { setErr(t('Новый пароль — от 8 символов')); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/auth/2fa/revoke', { method: 'POST', body: JSON.stringify({ token, password, next }) });
      setOk(true);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Ссылка недействительна или истекла')));
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 12 }}>{t('Выключить вход с кодом')}</h1>
      {ok ? (
        <div className="stack-form">
          <p role="status" style={{ margin: 0 }}>
            {t('Вход с кодом выключен, пароль новый, все устройства вышли из аккаунта.')}
          </p>
          <Link href="/login" className="btn" style={{ width: '100%' }}>{t('Войти с новым паролем')}</Link>
        </div>
      ) : (
        <>
          <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
            {t('Вход с кодом из приложения включили не вы? Введите пароль, который был у аккаунта в тот момент, и задайте новый.')}
          </p>
          <form onSubmit={submit} className="stack-form">
            <div className="field">
              <label className="label" htmlFor="tf-old">{t('Пароль на момент включения')}</label>
              <input id="tf-old" className="input" type="password" autoComplete="current-password" value={password} required
                onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label className="label" htmlFor="tf-next">{t('Новый пароль')}</label>
              <input id="tf-next" className="input" type="password" autoComplete="new-password" value={next} required
                minLength={8} onChange={(e) => setNext(e.target.value)} />
              <p className="hint">{t('От 8 символов. Все устройства выйдут из аккаунта.')}</p>
            </div>
            {err && (
              <div role="alert" style={{ fontSize: 14 }}>
                <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
                <Link href="/recover" style={{ display: 'inline-block', marginTop: 6 }}>{t('Не помните тот пароль? Заявка в поддержку')}</Link>
              </div>
            )}
            <button className="btn" type="submit" disabled={busy || !password || !next} style={{ width: '100%' }}>
              {busy ? '…' : t('Выключить и сменить пароль')}
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

export default function RecoverTwoFactorPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <RecoverInner />
    </Suspense>
  );
}
