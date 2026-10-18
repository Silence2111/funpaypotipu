'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setSession, type SessionUser } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Код ошибки входа из тела ответа: two_factor_required, too_many_attempts… */
function errorCode(e: unknown): string | null {
  try {
    return (JSON.parse(e instanceof Error ? e.message : '') as { error?: string }).error ?? null;
  } catch {
    return null;
  }
}

/** Куда вернуть после входа: только свой путь, не внешний адрес. */
function safeNext(raw: string | null, fallback: string) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : fallback;
}

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  return (
    <Suspense fallback={null}>
      <AuthFormInner mode={mode} />
    </Suspense>
  );
}

function AuthFormInner({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const params = useSearchParams();
  const isRegister = mode === 'register';
  const next = safeNext(params.get('next'), isRegister ? '/catalog' : '/cabinet');
  const seller = params.get('seller') === '1';

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Второй шаг входа: код из приложения или резервный.
  const [codeStep, setCodeStep] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((t) => ({ ...t, [k]: true }));

  const errors: Record<string, string | null> = {
    email: !email ? 'Введите почту' : EMAIL_RE.test(email) ? null : 'Нужен вид name@mail.ru',
    username: !isRegister
      ? null
      : username.trim().length >= 3
        ? null
        : 'Имя в профиле — от 3 символов, его увидят продавцы и покупатели',
    password: !password
      ? isRegister ? 'Придумайте пароль' : 'Введите пароль'
      : isRegister && password.length < 8
        ? 'Пароль — не короче 8 символов'
        : null,
    agreed: isRegister && !agreed ? 'Без согласия с правилами аккаунт не создать' : null,
  };
  const show = (k: string) => (touched[k] ? errors[k] : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, username: true, password: true, agreed: true });
    if (Object.values(errors).some(Boolean)) return;
    if (codeStep && !code.trim()) {
      setError(recovery ? 'Введите резервный код' : 'Введите код из приложения');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const path = isRegister ? '/auth/register' : '/auth/login';
      const payload = isRegister
        ? { email, password, username: username.trim() }
        : { email, password, ...(codeStep && code.trim() ? { code: code.trim() } : {}) };
      const res = await apiFetch<AuthResponse>(path, { method: 'POST', body: JSON.stringify(payload) });
      setSession(res.accessToken, res.user);
      router.push(next);
    } catch (err) {
      const kind = errorCode(err);
      if (kind === 'two_factor_required') {
        // Пароль верный — спрашиваем код. Раньше форма его не спрашивала, и
        // включивший защиту больше не мог войти.
        setCodeStep(true);
        setError(null);
      } else if (kind === 'two_factor_invalid' || kind === 'two_factor_locked' || kind === 'too_many_attempts') {
        setError(apiErrorMessage(err, 'Не получилось войти. Попробуйте ещё раз.'));
      } else {
        setError(
          isRegister
            ? apiErrorMessage(err, 'Не удалось создать аккаунт. Попробуйте ещё раз.')
            : 'Почта или пароль не подошли. Проверьте раскладку и попробуйте ещё раз.',
        );
      }
      setBusy(false);
    }
  }

  const q = params.toString() ? `?${params.toString()}` : '';

  return (
    <div style={{ maxWidth: 420, margin: '56px auto', padding: '0 16px' }}>
      <h1 className="h1" style={{ fontSize: 30 }}>
        {isRegister ? (seller ? 'Аккаунт продавца' : 'Создать аккаунт') : 'Вход'}
      </h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>
        {isRegister
          ? seller
            ? 'Один аккаунт и для покупок, и для продаж. После регистрации сразу откроется форма лота.'
            : 'Бесплатно. Один аккаунт — и покупать, и продавать.'
          : 'Войдите, чтобы купить, продать или открыть заказ.'}
      </p>
      <form onSubmit={submit} className="card stack-form" style={{ gap: 16, padding: 24 }} noValidate>
        {codeStep ? (
          <div className="field">
            <label className="label" htmlFor="code">
              {recovery ? 'Резервный код' : 'Код из приложения-аутентификатора'}
            </label>
            <input id="code" className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
              inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} maxLength={recovery ? 20 : 6}
              placeholder={recovery ? 'abcde-fghjk' : '123456'} />
            <p className="hint">
              {recovery ? 'Каждый резервный код работает один раз.' : 'Шесть цифр из Google Authenticator, 1Password или похожего.'}{' '}
              <button type="button" className="link-button" onClick={() => { setRecovery(!recovery); setCode(''); }}>
                {recovery ? 'Ввести код из приложения' : 'Нет телефона — ввести резервный код'}
              </button>
            </p>
          </div>
        ) : (
        <>
        <div className="field">
          <label className="label" htmlFor="email">Почта</label>
          <input id="email" className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            placeholder="name@mail.ru"
            value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch('email')}
            aria-invalid={!!show('email')} />
          {show('email') && <p className="field-error">{show('email')}</p>}
        </div>
        {isRegister && (
          <div className="field">
            <label className="label" htmlFor="username">Имя в профиле</label>
            <input id="username" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off"
              spellCheck={false} placeholder="Например, nightfox"
              value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => touch('username')}
              aria-invalid={!!show('username')} />
            {show('username') ? <p className="field-error">{show('username')}</p> : <p className="hint">Строчные латинские буквы, цифры и _, от 3 символов</p>}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="password">Пароль</label>
          <input id="password" className="input" type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch('password')}
            aria-invalid={!!show('password')} />
          {show('password') ? <p className="field-error">{show('password')}</p> : isRegister ? <p className="hint">Не короче 8 символов</p> : null}
        </div>
        {isRegister && (
          <div className="field">
            <label className="row muted" style={{ gap: 10, fontSize: 14, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); touch('agreed'); }}
                style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)', flex: 'none' }} />
              <span>
                Мне есть 18 лет, я принимаю <Link href="/rules" style={{ color: 'var(--accent)' }}>правила</Link>,{' '}
                <Link href="/oferta" style={{ color: 'var(--accent)' }}>оферту</Link> и согласен на{' '}
                <Link href="/privacy" style={{ color: 'var(--accent)' }}>обработку персональных данных</Link>
              </span>
            </label>
            {show('agreed') && <p className="field-error">{show('agreed')}</p>}
          </div>
        )}
        </>
        )}
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="btn lg block" type="submit" disabled={busy}>
          {busy ? (isRegister ? 'Создаём аккаунт…' : 'Входим…') : isRegister ? 'Создать аккаунт' : 'Войти'}
        </button>
        {codeStep && (
          <button type="button" className="link-button" style={{ alignSelf: 'center' }}
            onClick={() => { setCodeStep(false); setCode(''); setError(null); }}>
            ← Другая почта или пароль
          </button>
        )}
      </form>
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        {isRegister ? (
          <>Уже есть аккаунт? <Link href={`/login${q}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Войти</Link></>
        ) : (
          <>Нет аккаунта? <Link href={`/register${q}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>Создать</Link></>
        )}
      </p>
      {!isRegister && (
        <p style={{ fontSize: 14, marginTop: 4, textAlign: 'center' }}>
          <Link href="/forgot" className="faint">Забыли пароль?</Link>
        </p>
      )}
    </div>
  );
}
