'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, Loader } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

function VerifyInner() {
  const t = useT();
  const params = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'ok' | 'fail'>('loading');

  useEffect(() => {
    if (!token) { setState('fail'); return; }
    apiFetch('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) })
      .then(() => setState('ok'))
      .catch(() => setState('fail'));
  }, [token]);

  return (
    <div style={{ maxWidth: 380, margin: '90px auto', padding: '0 24px', textAlign: 'center' }}>
      <div style={{ marginBottom: 12, lineHeight: 0 }} aria-hidden>
        {state === 'ok' ? (
          <CheckCircle2 size={40} strokeWidth={1.75} color="var(--success)" />
        ) : state === 'fail' ? (
          <AlertTriangle size={40} strokeWidth={1.75} color="var(--warning)" />
        ) : (
          <Loader size={40} strokeWidth={1.75} className="faint" />
        )}
      </div>
      <h1 className="h2" style={{ marginBottom: 12 }}>
        {state === 'ok' ? t('Почта подтверждена') : state === 'fail' ? t('Не удалось подтвердить') : t('Проверяем…')}
      </h1>
      <p className="muted">
        {state === 'ok' ? t('Спасибо, аккаунт подтверждён.')
          : state === 'fail' ? t('Ссылка недействительна или истекла.') : ''}
      </p>
      <p style={{ marginTop: 20 }}><Link href="/cabinet" className="chip">{t('В кабинет')}</Link></p>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <VerifyInner />
    </Suspense>
  );
}
