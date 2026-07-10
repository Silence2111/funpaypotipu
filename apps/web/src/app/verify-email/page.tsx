'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';

function VerifyInner() {
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
      <div style={{ fontSize: 44, marginBottom: 12 }}>{state === 'ok' ? '✅' : state === 'fail' ? '⚠️' : '⏳'}</div>
      <h1 className="h2" style={{ marginBottom: 12 }}>
        {state === 'ok' ? 'E-mail подтверждён' : state === 'fail' ? 'Не удалось подтвердить' : 'Проверяем…'}
      </h1>
      <p className="muted">
        {state === 'ok' ? 'Спасибо! Аккаунт подтверждён.'
          : state === 'fail' ? 'Ссылка недействительна или истекла.' : ''}
      </p>
      <p style={{ marginTop: 20 }}><Link href="/cabinet" className="chip">В кабинет</Link></p>
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
