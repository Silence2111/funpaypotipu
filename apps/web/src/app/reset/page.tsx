'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

function ResetInner() {
  const t = useT();
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  // «Это не я» из письма «Пароль изменён»: пароль сменил кто-то другой.
  const notMe = params.get('not_me') === '1';
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) { setErr(t('Нет токена в ссылке')); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      setOk(true);
      // После «Это не я» человек читает, что случилось, и входит сам.
      if (!notMe) setTimeout(() => router.push('/login'), 1500);
    } catch {
      setErr(t('Ссылка недействительна или истекла'));
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: notMe ? 12 : 24 }}>
        {notMe ? t('Восстановить доступ') : t('Новый пароль')}
      </h1>
      {ok ? (
        notMe ? (
          <div className="stack-form">
            <p role="status" style={{ margin: 0 }}>
              {t('Доступ восстановлен: пароль новый, все устройства вышли из аккаунта.')}
            </p>
            <Link href="/login" className="btn" style={{ width: '100%' }}>{t('Войти с новым паролем')}</Link>
          </div>
        ) : (
          <p className="muted">{t('Пароль обновлён. Перенаправляем ко входу…')}</p>
        )
      ) : (
        <>
          {notMe && (
            <p className="muted" style={{ fontSize: 14, margin: '0 0 24px' }}>
              {t('Пароль сменили не вы? Задайте новый: все устройства, где выполнен вход, выйдут из аккаунта.')}
            </p>
          )}
          <form onSubmit={submit} className="stack-form">
            <input className="input" type="password" autoComplete="new-password" placeholder={t('Новый пароль')} aria-label={t('Новый пароль')} value={password} required
              minLength={8} onChange={(e) => setPassword(e.target.value)} />
            {err && (
              <div role="alert" style={{ fontSize: 14 }}>
                <p style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>
                <Link href="/forgot" style={{ display: 'inline-block', marginTop: 6 }}>{t('Запросить новую ссылку')}</Link>
              </div>
            )}
            <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
              {busy ? '…' : t('Сохранить пароль')}
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

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <ResetInner />
    </Suspense>
  );
}
