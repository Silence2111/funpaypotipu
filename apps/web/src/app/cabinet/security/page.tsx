'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, MonitorSmartphone } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { TwoFactorCard } from '@/components/two-factor-card';
import { KycCard } from '@/components/kyc-card';

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

/** «Chrome · Windows» из User-Agent — достаточно, чтобы узнать своё устройство. */
function deviceOf(ua: string | null): string {
  if (!ua) return 'Неизвестное устройство';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? 'Яндекс Браузер'
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Браузер';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Безопасность: пароль, где выполнен вход, двухфакторная защита, проверка личности. */
export default function SecurityPage() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const load = useCallback(async () => {
    setSessions(await apiFetch<Session[]>('/auth/sessions').catch(() => []));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet/security');
      return;
    }
    void load();
  }, [router, load]);

  async function run(fn: () => Promise<string>, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fallback) });
    } finally {
      setBusy(false);
    }
  }

  function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setMsg({ ok: false, text: 'Новый пароль — от 8 символов' });
    void run(async () => {
      const r = await apiFetch<{ closedSessions: number }>('/auth/password', {
        method: 'POST',
        body: JSON.stringify({ current, next }),
      });
      setCurrent('');
      setNext('');
      return r.closedSessions
        ? `Пароль изменён. Другие устройства вышли из аккаунта: ${r.closedSessions}.`
        : 'Пароль изменён.';
    }, 'Не удалось сменить пароль.');
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>Безопасность</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {msg && (
        <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
          <KeyRound size={18} strokeWidth={1.75} /> Пароль
        </h2>
        <form onSubmit={changePassword} className="stack-form" style={{ gap: 14, marginTop: 14 }}>
          <div className="field">
            <label className="label" htmlFor="pwd-current">Текущий пароль</label>
            <input id="pwd-current" className="input" type="password" autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div className="field">
            <label className="label" htmlFor="pwd-next">Новый пароль</label>
            <input id="pwd-next" className="input" type="password" autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)} />
            <p className="hint">От 8 символов. Другие устройства выйдут из аккаунта сразу.</p>
          </div>
          <div>
            <button className="btn" type="submit" disabled={busy || !current || !next}>Сменить пароль</button>
          </div>
        </form>
      </section>

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
            <MonitorSmartphone size={18} strokeWidth={1.75} /> Где выполнен вход
          </h2>
          {others.length > 0 && (
            <button type="button" className="chip" disabled={busy}
              onClick={() => void run(async () => {
                const r = await apiFetch<{ closedSessions: number }>('/auth/sessions/revoke-others', { method: 'POST' });
                return `Завершено сеансов: ${r.closedSessions}.`;
              }, 'Не удалось завершить сеансы.')}>
              Завершить все, кроме этого
            </button>
          )}
        </div>
        {sessions === null ? (
          <div className="skeleton" style={{ height: 60, marginTop: 14 }} aria-busy="true" />
        ) : (
          <div className="grid" style={{ gap: 8, marginTop: 14 }}>
            {sessions.map((s) => (
              <div key={s.id} className="row" style={{ justifyContent: 'space-between', gap: 12, padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <span>
                  <span style={{ fontWeight: 600 }}>{deviceOf(s.userAgent)}</span>
                  {s.current && <span className="badge success" style={{ marginLeft: 8 }}>это устройство</span>}
                  <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                    вход {when(s.signedInAt)}{s.ip ? ` · ${s.ip}` : ''}
                  </span>
                </span>
                {!s.current && (
                  <button type="button" className="chip" disabled={busy}
                    onClick={() => void run(async () => {
                      await apiFetch(`/auth/sessions/${s.id}/revoke`, { method: 'POST' });
                      return 'Сеанс завершён — устройство вышло из аккаунта.';
                    }, 'Не удалось завершить сеанс.')}>
                    Завершить
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <TwoFactorCard />
      <KycCard />
    </div>
  );
}
