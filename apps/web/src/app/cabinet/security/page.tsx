'use client';

import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { KeyRound, LifeBuoy, MonitorSmartphone, ShieldAlert } from 'lucide-react';
import { deviceOf } from '@gamemarket/shared';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { CabinetNav } from '@/components/cabinet-nav';
import { TwoFactorCard } from '@/components/two-factor-card';
import { KycCard } from '@/components/kyc-card';
import { SocialAccounts, type LoginWays } from '@/components/social-accounts';
import { useT } from '@/lib/i18n/client';
import { msg, type T } from '@/lib/i18n/lang';

/** Заявка «Не могу войти» на этот аккаунт, которая ждёт решения сотрудника. */
interface Recovery {
  id: string;
  createdAt: string;
  userAgent: string | null;
  objected: boolean;
  /** Просят привязать новую почту — так уводят аккаунты, владельцу это важно знать. */
  newEmail: boolean;
  decideAfter: string;
}

interface Session {
  id: string;
  userAgent: string | null;
  ip: string | null;
  signedInAt: string;
  lastActiveAt: string;
  current: boolean;
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
  const params = useSearchParams();
  const linked = params.get('social');
  // Пришли из уведомления «Вход с нового устройства»: какой сеанс проверить.
  const asked = params.get('session');
  const [answer, setAnswer] = useState<'me' | 'ended' | null>(null);
  const [notice, setMsg] = useState<{ ok: boolean; text: string } | null>(() => {
    const r = linked ? LINKED[linked] : undefined;
    return r ? { ok: r.ok, text: t(r.text) } : null;
  });
  const [ways, setWays] = useState<LoginWays | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);

  const load = useCallback(async () => {
    setSessions(await apiFetch<Session[]>('/auth/sessions').catch(() => []));
    setWays(await apiFetch<LoginWays>('/auth/social/accounts').catch(() => null));
    setRecovery((await apiFetch<{ request: Recovery | null }>('/recovery/mine').catch(() => null))?.request ?? null);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      const back = asked ? `/cabinet/security?session=${encodeURIComponent(asked)}` : '/cabinet/security';
      router.replace(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    void load();
  }, [router, load, asked]);

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
  // Вопрос «Это были вы?» — пока не ответили; сеанс мог уже закончиться.
  const asking = !!asked && sessions !== null && answer === null;
  const target = asking ? (sessions.find((s) => s.id === asked) ?? null) : null;
  const suspect = target && !target.current ? target : null;

  /** «Это не я»: завершить этот сеанс, забыть устройство и перейти к смене пароля. */
  function notMe(s: Session) {
    void run(async () => {
      await apiFetch(`/auth/sessions/${s.id}/not-me`, { method: 'POST' });
      setAnswer('ended');
      // Смена пароля выводит и остальные устройства — к ней и ведём.
      setTimeout(() => document.getElementById(firstPassword ? 'pwd-next' : 'pwd-current')?.focus(), 0);
      return firstPassword
        ? t('Сеанс завершён — устройство вышло из аккаунта. Проверьте, какие сервисы подключены для входа.')
        : t('Сеанс завершён — устройство вышло из аккаунта. Смените пароль: тогда выйдут и все остальные устройства.');
    }, t('Не удалось завершить сеанс.'));
  }

  /** «Заявку подал не я»: не отмена — знак сотруднику, что заявку подал не владелец. */
  function objectRecovery(r: Recovery) {
    void run(async () => {
      await apiFetch(`/recovery/${r.id}/object`, { method: 'POST' });
      return t('Отмечено: сотрудник увидит, что заявку подали не вы.');
    }, t('Не удалось отметить заявку.'));
  }

  function itWasMe() {
    setAnswer('me');
    router.replace('/cabinet/security', { scroll: false });
  }

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

      {recovery && (
        <section className="card new-login" style={{ padding: 24, maxWidth: 600 }} aria-labelledby="recovery-title">
          <h2 id="recovery-title" className="h2 row" style={{ fontSize: 18, gap: 8 }}>
            <LifeBuoy size={18} strokeWidth={1.75} /> {t('Заявка на восстановление доступа')}
          </h2>
          <p style={{ margin: '12px 0 0' }}>
            <span style={{ fontWeight: 600 }}>{deviceOf(recovery.userAgent, t.lang)}</span>
            <span className="faint" style={{ display: 'block', fontSize: 13 }}>
              {t('подана {when}', { when: when(recovery.createdAt, t) })}
            </span>
          </p>
          <p className="muted" style={{ fontSize: 14, margin: '12px 0 0' }}>
            {recovery.newEmail
              ? t('Кто-то сообщил поддержке, что не может войти в этот аккаунт, и просит сменить его почту. Сотрудник решит не раньше {date}. Если это не вы — обязательно отметьте это.', {
                  date: when(recovery.decideAfter, t),
                })
              : t('Кто-то сообщил поддержке, что не может войти в этот аккаунт. Сотрудник решит не раньше {date}. Если это вы — ждите ответа на почту. Если не вы — отметьте это, сотрудник увидит до решения.', {
                  date: when(recovery.decideAfter, t),
                })}
          </p>
          <div style={{ marginTop: 12 }}>
            {recovery.objected ? (
              <span className="badge">{t('Отмечено: заявку подали не вы')}</span>
            ) : (
              <button type="button" className="btn secondary" disabled={busy} onClick={() => objectRecovery(recovery)}>
                {t('Заявку подал не я')}
              </button>
            )}
          </div>
        </section>
      )}

      {asking && (
        <section className="card new-login" style={{ padding: 24, maxWidth: 600 }} aria-labelledby="new-login-title">
          <h2 id="new-login-title" className="h2 row" style={{ fontSize: 18, gap: 8 }}>
            <ShieldAlert size={18} strokeWidth={1.75} /> {t('Вход с нового устройства')}
          </h2>
          {suspect ? (
            <>
              <p style={{ margin: '12px 0 0' }}>
                <span style={{ fontWeight: 600 }}>{deviceOf(suspect.userAgent, t.lang)}</span>
                <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                  {t('вход {when}', { when: when(suspect.signedInAt, t) })}
                  {suspect.ip ? ` · IP ${suspect.ip}` : ''}
                </span>
              </p>
              <p style={{ margin: '16px 0 0', fontWeight: 600 }}>{t('Это были вы?')}</p>
              <div className="row" style={{ gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" className="btn" disabled={busy} onClick={() => notMe(suspect)}>
                  {t('Это не я — завершить сеанс')}
                </button>
                <button type="button" className="btn secondary" disabled={busy} onClick={itWasMe}>
                  {t('Да, это я')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted" style={{ margin: '12px 0 0', fontSize: 14 }}>
                {target
                  ? t('Этот вход — с устройства, на котором вы сейчас. Если это были вы, ничего делать не нужно.')
                  : t('Этот сеанс уже завершён: устройство вышло из аккаунта. Если входили не вы — смените пароль.')}
              </p>
              <div style={{ marginTop: 12 }}>
                <button type="button" className="chip" onClick={itWasMe}>{t('Понятно')}</button>
              </div>
            </>
          )}
        </section>
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
              {/* Пока ждёт ответ «Это были вы?» — акцент у него, а не у пароля. */}
              <button className={suspect ? 'btn secondary' : 'btn'} type="submit"
                disabled={busy || (!firstPassword && !current) || !next}>
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
              <div key={s.id} className={`row session-row${s.id === suspect?.id ? ' flagged' : ''}`}>
                <span>
                  <span style={{ fontWeight: 600 }}>{deviceOf(s.userAgent, t.lang)}</span>
                  {s.current && <span className="badge success" style={{ marginLeft: 8 }}>{t('это устройство')}</span>}
                  {s.id === suspect?.id && <span className="badge" style={{ marginLeft: 8 }}>{t('новый вход')}</span>}
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
