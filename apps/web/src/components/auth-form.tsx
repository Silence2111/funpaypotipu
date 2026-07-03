'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setSession, type SessionUser } from '@/lib/session';

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isRegister = mode === 'register';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = isRegister ? '/auth/register' : '/auth/login';
      const payload = isRegister ? { email, password, username } : { email, password };
      const res = await apiFetch<AuthResponse>(path, { method: 'POST', body: JSON.stringify(payload) });
      setSession(res.accessToken, res.user);
      router.push('/cabinet');
    } catch {
      setError(isRegister ? 'Не удалось зарегистрироваться' : 'Неверный email или пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: '0 24px' }}>
      <h1 className="h2" style={{ marginBottom: 24 }}>
        {isRegister ? 'Создать аккаунт' : 'Вход'}
      </h1>
      <form onSubmit={submit} className="stack-form">
        <input className="input" type="email" placeholder="Email" value={email} required
          onChange={(e) => setEmail(e.target.value)} />
        {isRegister && (
          <input className="input" placeholder="Имя пользователя" value={username} required minLength={3}
            onChange={(e) => setUsername(e.target.value)} />
        )}
        <input className="input" type="password" placeholder="Пароль" value={password} required minLength={8}
          onChange={(e) => setPassword(e.target.value)} />
        {error && <p style={{ color: '#d33', fontSize: 14, margin: 0 }}>{error}</p>}
        <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? '…' : isRegister ? 'Зарегистрироваться' : 'Войти'}
        </button>
      </form>
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        {isRegister ? (
          <>Уже есть аккаунт? <Link href="/login">Войти</Link></>
        ) : (
          <>Нет аккаунта? <Link href="/register">Создать</Link></>
        )}
      </p>
    </div>
  );
}
