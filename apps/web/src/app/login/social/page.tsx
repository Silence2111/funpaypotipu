'use client';

import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, setSession, type SessionUser } from '@/lib/session';
import { apiErrorMessage, errorBody } from '@/lib/errors';

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

const LABEL: Record<string, string> = { google: 'Google', vk: 'VK ID', telegram: 'Telegram' };
const USERNAME_RE = /^[a-z0-9_]{3,32}$/;

const safeNext = (raw: string | null) =>
  raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';

type Phase = 'loading' | 'username' | 'code' | 'error';

/**
 * Завершение входа через Telegram, VK ID или Google. Сервис уже подтвердил
 * личность (билет — в cookie API). Новому человеку — выбрать ник и принять
 * правила, как при регистрации; с защитой входа — код из приложения.
 */
function Complete() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [phase, setPhase] = useState<Phase>('loading');
  const [provider, setProvider] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [username, setUsername] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const send = useCallback(
    async (extra: { username?: string; code?: string }) => {
      setBusy(true);
      setMsg(null);
      try {
        const r = await apiFetch<AuthResponse>('/auth/social/complete', {
          method: 'POST',
          body: JSON.stringify(extra),
        });
        setSession(r.accessToken, r.user);
        router.replace(next);
        return;
      } catch (e) {
        const body = errorBody(e) as {
          error?: string;
          suggested?: string;
          name?: string;
          provider?: string;
        } | null;
        switch (body?.error) {
          case 'username_required':
            setPhase('username');
            setProvider(body.provider ?? null);
            setName(body.name ?? null);
            setUsername((u) => u || body.suggested || '');
            break;
          case 'username_taken':
            setMsg(`Ник занят${body.suggested ? ` — например, свободен ${body.suggested}` : ''}`);
            break;
          case 'two_factor_required':
            setPhase('code');
            break;
          case 'social_email_taken':
          case 'social_expired':
            setPhase('error');
            setMsg(apiErrorMessage(e, 'Вход не завершён. Начните заново.'));
            break;
          default:
            if (phase === 'loading') setPhase('error');
            setMsg(apiErrorMessage(e, 'Не получилось войти. Попробуйте ещё раз.'));
        }
      }
      setBusy(false);
    },
    [next, phase, router],
  );

  // Один запрос при открытии: в разработке React вызывает эффекты дважды,
  // а билет после входа одноразовый.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send({});
  }, [send]);

  function submitUsername(e: FormEvent) {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u))
      return setMsg('Ник — строчные латинские буквы, цифры и _, от 3 символов');
    if (!agreed) return setMsg('Без согласия с правилами аккаунт не создать');
    void send({ username: u });
  }

  function submitCode(e: FormEvent) {
    e.preventDefault();
    if (!code.trim())
      return setMsg(recovery ? 'Введите резервный код' : 'Введите код из приложения');
    void send({ code: code.trim() });
  }

  const via = provider ? LABEL[provider] : null;

  return (
    <div style={{ maxWidth: 420, margin: '56px auto', padding: '0 16px' }}>
      <h1 className="h1" style={{ fontSize: 30 }}>
        {phase === 'username' ? 'Почти готово' : phase === 'code' ? 'Код из приложения' : 'Вход'}
      </h1>
      {phase === 'loading' && (
        <p className="muted" role="status" style={{ margin: '8px 0 0' }}>
          Входим…
        </p>
      )}

      {phase === 'username' && (
        <form
          onSubmit={submitUsername}
          className="card stack-form"
          style={{ gap: 16, padding: 24, marginTop: 20 }}
          noValidate
        >
          <p className="muted" style={{ margin: 0 }}>
            {name ? `${name}, вы` : 'Вы'} входите через {via ?? 'сервис'} впервые. Выберите ник — по
            нему вас найдут покупатели и продавцы, сменить его потом нельзя.
          </p>
          <div className="field">
            <label className="label" htmlFor="username">
              Ник
            </label>
            <input
              id="username"
              className="input"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
            <p className="hint">Строчные латинские буквы, цифры и _, от 3 символов</p>
          </div>
          <label
            className="row muted"
            style={{
              gap: 10,
              fontSize: 14,
              alignItems: 'flex-start',
              minHeight: 44,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{
                marginTop: 3,
                width: 18,
                height: 18,
                accentColor: 'var(--accent)',
                flex: 'none',
              }}
            />
            <span>
              Мне есть 18 лет, я принимаю{' '}
              <Link href="/rules" style={{ color: 'var(--accent)' }}>
                правила
              </Link>
              ,{' '}
              <Link href="/oferta" style={{ color: 'var(--accent)' }}>
                оферту
              </Link>{' '}
              и согласен на{' '}
              <Link href="/privacy" style={{ color: 'var(--accent)' }}>
                обработку персональных данных
              </Link>
            </span>
          </label>
          {msg && (
            <div className="alert error" role="alert">
              {msg}
            </div>
          )}
          <button className="btn lg block" type="submit" disabled={busy}>
            {busy ? 'Создаём аккаунт…' : 'Создать аккаунт'}
          </button>
        </form>
      )}

      {phase === 'code' && (
        <form
          onSubmit={submitCode}
          className="card stack-form"
          style={{ gap: 16, padding: 24, marginTop: 20 }}
          noValidate
        >
          <div className="field">
            <label className="label" htmlFor="code">
              {recovery ? 'Резервный код' : 'Код из приложения-аутентификатора'}
            </label>
            <input
              id="code"
              className="input"
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode={recovery ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={recovery ? 20 : 6}
              placeholder={recovery ? 'abcde-fghjk' : '123456'}
            />
            <p className="hint">
              У аккаунта включена двухфакторная защита — она действует и при входе через сервис.{' '}
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  setRecovery(!recovery);
                  setCode('');
                }}
              >
                {recovery ? 'Ввести код из приложения' : 'Нет телефона — ввести резервный код'}
              </button>
            </p>
          </div>
          {msg && (
            <div className="alert error" role="alert">
              {msg}
            </div>
          )}
          <button className="btn lg block" type="submit" disabled={busy}>
            {busy ? 'Входим…' : 'Войти'}
          </button>
        </form>
      )}

      {phase === 'error' && (
        <div className="card stack-form" style={{ gap: 16, padding: 24, marginTop: 20 }}>
          <div className="alert error" role="alert">
            {msg ?? 'Вход не завершён. Начните заново.'}
          </div>
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="btn secondary block">
            Ко входу
          </Link>
        </div>
      )}
    </div>
  );
}

export default function SocialCompletePage() {
  return (
    <Suspense fallback={null}>
      <Complete />
    </Suspense>
  );
}
