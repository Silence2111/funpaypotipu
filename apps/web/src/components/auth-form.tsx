'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch, setSession, type SessionUser } from '@/lib/session';
import { apiErrorMessage, errorCode } from '@/lib/errors';
import { SocialLogin } from '@/components/social-login';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Почему не получился вход через сервис — код из адреса возврата API. */
const SOCIAL_ERRORS: Record<string, string> = {
  expired: msg('Вход через сервис занял больше 10 минут. Начните заново.'),
  state: msg('Вход начали в другой вкладке или браузере. Начните заново здесь.'),
  cancelled: msg('Вход отменён в сервисе.'),
  provider: msg('Сервис не подтвердил вход. Попробуйте ещё раз или войдите по почте.'),
  network: msg('Сервис не ответил. Попробуйте ещё раз или войдите по почте.'),
  disabled: msg('Этот способ входа сейчас недоступен.'),
};

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
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const isRegister = mode === 'register';
  const next = safeNext(params.get('next'), isRegister ? '/catalog' : '/cabinet');
  const seller = params.get('seller') === '1';

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const socialError = params.get('social_error');
  const [error, setError] = useState<string | null>(
    socialError ? t(SOCIAL_ERRORS[socialError] ?? SOCIAL_ERRORS.disabled!) : null,
  );
  const [busy, setBusy] = useState(false);
  // Второй шаг входа: код из приложения или резервный.
  const [codeStep, setCodeStep] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const touch = (k: string) => setTouched((prev) => ({ ...prev, [k]: true }));

  const errors: Record<string, string | null> = {
    email: !email ? t('Введите почту') : EMAIL_RE.test(email) ? null : t('Нужен вид name@mail.ru'),
    username: !isRegister
      ? null
      : username.trim().length >= 3
        ? null
        : t('Имя в профиле — от 3 символов, его увидят продавцы и покупатели'),
    password: !password
      ? isRegister ? t('Придумайте пароль') : t('Введите пароль')
      : isRegister && password.length < 8
        ? t('Пароль — не короче 8 символов')
        : null,
    agreed: isRegister && !agreed ? t('Без согласия с правилами аккаунт не создать') : null,
  };
  const show = (k: string) => (touched[k] ? errors[k] : null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched({ email: true, username: true, password: true, agreed: true });
    if (Object.values(errors).some(Boolean)) return;
    if (codeStep && !code.trim()) {
      setError(recovery ? t('Введите резервный код') : t('Введите код из приложения'));
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
        setError(apiErrorMessage(err, t('Не получилось войти. Попробуйте ещё раз.')));
      } else {
        setError(
          isRegister
            ? apiErrorMessage(err, t('Не удалось создать аккаунт. Попробуйте ещё раз.'))
            : t('Почта или пароль не подошли. Проверьте раскладку и попробуйте ещё раз.'),
        );
      }
      setBusy(false);
    }
  }

  const q = params.toString() ? `?${params.toString()}` : '';

  return (
    <div style={{ maxWidth: 420, margin: '56px auto', padding: '0 16px' }}>
      <h1 className="h1" style={{ fontSize: 30 }}>
        {isRegister ? (seller ? t('Аккаунт продавца') : t('Создать аккаунт')) : t('Вход')}
      </h1>
      <p className="muted" style={{ margin: '8px 0 24px' }}>
        {isRegister
          ? seller
            ? t('Один аккаунт и для покупок, и для продаж. После регистрации сразу откроется форма лота.')
            : t('Бесплатно. Один аккаунт — и покупать, и продавать.')
          : t('Войдите, чтобы купить, продать или открыть заказ.')}
      </p>
      <form onSubmit={submit} className="card stack-form" style={{ gap: 16, padding: 24 }} noValidate>
        {codeStep ? (
          <div className="field">
            <label className="label" htmlFor="code">
              {recovery ? t('Резервный код') : t('Код из приложения-аутентификатора')}
            </label>
            <input id="code" className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
              inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoCapitalize="none"
              autoCorrect="off" spellCheck={false} maxLength={recovery ? 20 : 6}
              placeholder={recovery ? 'abcde-fghjk' : '123456'} />
            <p className="hint">
              {recovery
                ? t('Каждый резервный код работает один раз.')
                : t('Шесть цифр из Google Authenticator, 1Password или похожего.')}{' '}
              <button type="button" className="link-button" onClick={() => { setRecovery(!recovery); setCode(''); }}>
                {recovery ? t('Ввести код из приложения') : t('Нет телефона — ввести резервный код')}
              </button>
            </p>
          </div>
        ) : (
        <>
        <div className="field">
          <label className="label" htmlFor="email">{t('Почта')}</label>
          <input id="email" className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
            placeholder={t('name@mail.ru')}
            value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => touch('email')}
            aria-invalid={!!show('email')} />
          {show('email') && <p className="field-error">{show('email')}</p>}
        </div>
        {isRegister && (
          <div className="field">
            <label className="label" htmlFor="username">{t('Имя в профиле')}</label>
            <input id="username" className="input" autoComplete="username" autoCapitalize="none" autoCorrect="off"
              spellCheck={false} placeholder={t('Например, nightfox')}
              value={username} onChange={(e) => setUsername(e.target.value)} onBlur={() => touch('username')}
              aria-invalid={!!show('username')} />
            {show('username') ? <p className="field-error">{show('username')}</p> : <p className="hint">{t('Строчные латинские буквы, цифры и _, от 3 символов')}</p>}
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="password">{t('Пароль')}</label>
          <input id="password" className="input" type="password"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)} onBlur={() => touch('password')}
            aria-invalid={!!show('password')} />
          {show('password') ? <p className="field-error">{show('password')}</p> : isRegister ? <p className="hint">{t('Не короче 8 символов')}</p> : null}
        </div>
        {isRegister && (
          <div className="field">
            <label className="row muted" style={{ gap: 10, fontSize: 14, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' }}>
              <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); touch('agreed'); }}
                style={{ marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)', flex: 'none' }} />
              <span>
                {t('Мне есть 18 лет, я принимаю')}{' '}
                <Link href="/rules" style={{ color: 'var(--accent)' }}>{t('правила')}</Link>,{' '}
                <Link href="/oferta" style={{ color: 'var(--accent)' }}>{t('оферту')}</Link> {t('и согласен на')}{' '}
                <Link href="/privacy" style={{ color: 'var(--accent)' }}>{t('обработку персональных данных')}</Link>
              </span>
            </label>
            {show('agreed') && <p className="field-error">{show('agreed')}</p>}
          </div>
        )}
        </>
        )}
        {error && <div className="alert error" role="alert">{error}</div>}
        <button className="btn lg block" type="submit" disabled={busy}>
          {busy
            ? isRegister
              ? t('Создаём аккаунт…')
              : t('Входим…')
            : isRegister
              ? t('Создать аккаунт')
              : t('Войти')}
        </button>
        {codeStep && (
          <button type="button" className="link-button" style={{ alignSelf: 'center' }}
            onClick={() => { setCodeStep(false); setCode(''); setError(null); }}>
            {t('← Другая почта или пароль')}
          </button>
        )}
      </form>
      {!codeStep && <SocialLogin next={next} />}
      <p className="muted" style={{ fontSize: 14, marginTop: 20, textAlign: 'center' }}>
        {isRegister ? (
          <>
            {t('Уже есть аккаунт?')}{' '}
            <Link href={`/login${q}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('Войти')}</Link>
          </>
        ) : (
          <>
            {t('Нет аккаунта?')}{' '}
            <Link href={`/register${q}`} style={{ color: 'var(--accent)', fontWeight: 600 }}>{t('Создать')}</Link>
          </>
        )}
      </p>
      {!isRegister && (
        <p style={{ fontSize: 14, marginTop: 4, textAlign: 'center' }}>
          <Link href="/forgot" className="faint">{t('Забыли пароль?')}</Link>
        </p>
      )}
    </div>
  );
}
