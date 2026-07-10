'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiFetch('/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) });
    } catch {
      /* всегда показываем успех — без утечки существования e-mail */
    } finally {
      setSent(true);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 24 }}>Восстановление пароля</h1>
      {sent ? (
        <p className="muted" style={{ fontSize: 15 }}>
          Если такой e-mail зарегистрирован, мы отправили на него ссылку для сброса пароля (действует 1 час).
        </p>
      ) : (
        <form onSubmit={submit} className="stack-form">
          <input className="input" type="email" placeholder="Email" value={email} required
            onChange={(e) => setEmail(e.target.value)} />
          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? '…' : 'Отправить ссылку'}
          </button>
        </form>
      )}
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        <Link href="/login">← Ко входу</Link>
      </p>
    </div>
  );
}
