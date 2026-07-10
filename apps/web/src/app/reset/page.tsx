'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!token) { setErr('Нет токена в ссылке'); return; }
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password }) });
      setOk(true);
      setTimeout(() => router.push('/login'), 1500);
    } catch {
      setErr('Ссылка недействительна или истекла');
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 24 }}>Новый пароль</h1>
      {ok ? (
        <p className="muted">Пароль обновлён. Перенаправляем ко входу…</p>
      ) : (
        <form onSubmit={submit} className="stack-form">
          <input className="input" type="password" placeholder="Новый пароль" value={password} required
            minLength={8} onChange={(e) => setPassword(e.target.value)} />
          {err && <p style={{ color: '#d33', fontSize: 14, margin: 0 }}>{err}</p>}
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '…' : 'Сохранить пароль'}
          </button>
        </form>
      )}
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        <Link href="/login">← Ко входу</Link>
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
