'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';

export default function SecurityPage() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [disableCode, setDisableCode] = useState('');

  useEffect(() => {
    if (!getToken()) router.replace('/login');
  }, [router]);

  async function setup() {
    setMsg(null);
    const r = await apiFetch<{ secret: string; otpauth: string }>('/auth/2fa/setup', { method: 'POST' });
    setSecret(r.secret);
    setOtpauth(r.otpauth);
  }

  async function enable() {
    setMsg(null);
    try {
      await apiFetch('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) });
      setMsg('✅ Двухфакторная аутентификация включена');
      setSecret(null);
      setOtpauth(null);
      setCode('');
    } catch {
      setMsg('Неверный код');
    }
  }

  async function disable() {
    setMsg(null);
    try {
      await apiFetch('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code: disableCode }) });
      setMsg('2FA отключена');
      setDisableCode('');
    } catch {
      setMsg('Неверный код');
    }
  }

  return (
    <div className="container" style={{ maxWidth: 520, paddingTop: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="h1" style={{ fontSize: 30 }}>Безопасность</h1>
        <Link href="/cabinet" className="chip">← Кабинет</Link>
      </div>

      <section className="card">
        <h2 className="h2" style={{ fontSize: 18 }}>
          <ShieldCheck size={18} /> Двухфакторная аутентификация
        </h2>
        <p className="muted" style={{ fontSize: 14 }}>
          Добавьте секрет в приложение-аутентификатор (Google Authenticator, 1Password) и подтвердите кодом.
        </p>

        {!secret ? (
          <button className="btn" type="button" onClick={setup}>Подключить 2FA</button>
        ) : (
          <div className="stack-form" style={{ marginTop: 12 }}>
            <div className="card" style={{ fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>
              {secret}
              <div className="faint" style={{ marginTop: 8 }}>{otpauth}</div>
            </div>
            <input className="input" placeholder="6-значный код" value={code} onChange={(e) => setCode(e.target.value)} />
            <button className="btn" type="button" onClick={enable}>Включить</button>
          </div>
        )}

        <hr className="divider" style={{ margin: '20px 0' }} />
        <div className="stack-form">
          <span className="faint" style={{ fontSize: 13 }}>Отключить 2FA</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" placeholder="Код" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} />
            <button className="chip" type="button" onClick={disable}>Отключить</button>
          </div>
        </div>

        {msg && <p style={{ fontSize: 14, marginTop: 14 }}>{msg}</p>}
      </section>
    </div>
  );
}
