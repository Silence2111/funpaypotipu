'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, MonitorSmartphone } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { TwoFactorCard } from '@/components/two-factor-card';
import { KycCard } from '@/components/kyc-card';
import { SocialAccounts, type LoginWays } from '@/components/social-accounts';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
}

/** «Chrome · Windows» из User-Agent — достаточно, чтобы узнать своё устройство. */
function deviceOf(ua: string | null, t: T): string {
  if (!ua) return t('Неизвестное устройство');
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /YaBrowser/.test(ua) ? t('Яндекс Браузер')
    : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : t('Браузер');
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

const when = (iso: string, t: T) =>
  new Date(iso).toLocaleString(t.locale, { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

/** Чем закончилось подключение Google или VK — адрес возврата от API. */
const LINKED: Record<string, { ok: boolean; text: string }> = {
  linked: { ok: true, text: msg('Сервис подключён: теперь можно входить через него.') },
  conflict: { ok: false, text: msg('Этот аккаунт сервиса уже привязан к другому пользователю площадки.') },
  error: { ok: false, text: msg('Не удалось подключить сервис. Попробуйте ещё раз.') },
};

/** Безопасность: пароль, вход через сервисы, где выполнен вход, двухфакторная защита, проверка личности. */
export default function SecurityPage() {
  return (
    <Suspense fallback={null}>
      <Security />
    </Suspense>
  );
}

function Security() {
  const t = useT();
  const router = useRouter();
  const linked = useSearchParams().get('social');
  const [notice, setMsg] = useState<{ ok: boolean; text: string } | null>(() => {
    const r = linked ? LINKED[linked] : undefined;
    return r ? { ok: r.ok, text: t(r.text) } : null;
  });
  const [ways, setWays] = useState<LoginWays | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);

  const load = useCallback(async () => {
    setSessions(await apiFetch<Session[]>('/auth/sessions').catch(() => []));
    setWays(await apiFetch<LoginWays>('/auth/social/accounts').catch(() => null));
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

  // Аккаунт из Telegram, VK или Google: пароля нет, его задают без текущего.
  const firstPassword = ways !== null && !ways.hasPassword;

  function changePassword(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setMsg({ ok: false, text: t('Новый пароль — от 8 символов') });
    void run(async () => {
      const r = await apiFetch<{ closedSessions: number }>('/auth/password', {
        method: 'POST',
        body: JSON.stringify(firstPassword ? { next } : { current, next }),
      });
      setCurrent('');
      setNext('');
      if (firstPassword) return t('Пароль задан: теперь можно входить и по почте с паролем.');
      return r.closedSessions
        ? t('Пароль изменён. Другие устройства вышли из аккаунта: {n}.', { n: r.closedSessions })
        : t('Пароль изменён.');
    }, t('Не удалось сменить пароль.'));
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Безопасность')}</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      {notice && (
        <div className={notice.ok ? 'alert success' : 'alert error'} role={notice.ok ? 'status' : 'alert'}>
          {notice.text}
        </div>
      )}

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
          <KeyRound size={18} strokeWidth={1.75} /> {t('Пароль')}
        </h2>
        {firstPassword && !ways?.email ? (
          <p className="muted" style={{ fontSize: 14, margin: '10px 0 0' }}>
            {t(
              'Вход по паролю — это почта и пароль, а у аккаунта нет почты: он заведён через сервис. Подключите второй сервис ниже, чтобы не зависеть от одного.',
            )}
          </p>
        ) : (
          <form onSubmit={changePassword} className="stack-form" style={{ gap: 14, marginTop: 14 }}>
            {firstPassword ? (
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                {t('Пароля нет — аккаунт заведён через сервис. Задайте пароль, чтобы входить и по почте {email}.', {
                  email: ways?.email ?? '',
                })}
              </p>
            ) : (
              <div className="field">
                <label className="label" htmlFor="pwd-current">{t('Текущий пароль')}</label>
                <input id="pwd-current" className="input" type="password" autoComplete="current-password"
                  value={current} onChange={(e) => setCurrent(e.target.value)} />
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="pwd-next">{firstPassword ? t('Пароль') : t('Новый пароль')}</label>
              <input id="pwd-next" className="input" type="password" autoComplete="new-password"
                value={next} onChange={(e) => setNext(e.target.value)} />
              <p className="hint">
                {firstPassword ? t('От 8 символов.') : t('От 8 символов. Другие устройства выйдут из аккаунта сразу.')}
              </p>
            </div>
            <div>
              <button className="btn" type="submit" disabled={busy || (!firstPassword && !current) || !next}>
                {firstPassword ? t('Задать пароль') : t('Сменить пароль')}
              </button>
            </div>
          </form>
        )}
      </section>

      {ways && <SocialAccounts ways={ways} onChange={setWays} />}

      <section className="card" style={{ padding: 24, maxWidth: 600 }}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
            <MonitorSmartphone size={18} strokeWidth={1.75} /> {t('Где выполнен вход')}
          </h2>
          {others.length > 0 && (
            <button type="button" className="chip" disabled={busy}
              onClick={() => void run(async () => {
                const r = await apiFetch<{ closedSessions: number }>('/auth/sessions/revoke-others', { method: 'POST' });
                return t('Завершено сеансов: {n}.', { n: r.closedSessions });
              }, t('Не удалось завершить сеансы.'))}>
              {t('Завершить все, кроме этого')}
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
                  <span style={{ fontWeight: 600 }}>{deviceOf(s.userAgent, t)}</span>
                  {s.current && <span className="badge success" style={{ marginLeft: 8 }}>{t('это устройство')}</span>}
                  <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                    {t('вход {when}', { when: when(s.signedInAt, t) })}{s.ip ? ` · ${s.ip}` : ''}
                  </span>
                </span>
                {!s.current && (
                  <button type="button" className="chip" disabled={busy}
                    onClick={() => void run(async () => {
                      await apiFetch(`/auth/sessions/${s.id}/revoke`, { method: 'POST' });
                      return t('Сеанс завершён — устройство вышло из аккаунта.');
                    }, t('Не удалось завершить сеанс.'))}>
                    {t('Завершить')}
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
