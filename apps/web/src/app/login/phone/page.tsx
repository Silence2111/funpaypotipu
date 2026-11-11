'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { normalizeRuPhone } from '@gamemarket/shared/phone';
import { apiFetch, setSession, type SessionUser } from '@/lib/session';
import { apiErrorMessage, errorBody } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

interface AuthResponse {
  user: SessionUser;
  accessToken: string;
}

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const safeNext = (raw: string | null) => (raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/');

type Step = 'phone' | 'code' | 'totp' | 'username' | 'deleted';

const box = { gap: 16, padding: 24, marginTop: 20 } as const;
const check = { marginTop: 3, width: 18, height: 18, accentColor: 'var(--accent)', flex: 'none' } as const;
const checkRow = { gap: 10, fontSize: 14, alignItems: 'flex-start', minHeight: 44, cursor: 'pointer' } as const;

/**
 * Вход и регистрация по номеру телефона (часть 121): номер → код из SMS →
 * код из приложения, если он включён, или ник и согласия у нового аккаунта.
 * Номер — только российский мобильный (ч. 10 ст. 8 149-ФЗ).
 */
function PhoneLogin() {
  const t = useT();
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [wait, setWait] = useState(0);
  const [ticket, setTicket] = useState('');
  const [totp, setTotp] = useState('');
  const [username, setUsername] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [pdConsent, setPdConsent] = useState(false);
  const [eraseAt, setEraseAt] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ enabled: boolean }>('/auth/phone/config')
      .then((c) => setEnabled(c.enabled))
      .catch(() => setEnabled(false));
  }, []);

  // Обратный отсчёт до нового кода.
  useEffect(() => {
    if (wait <= 0) return;
    const id = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(id);
  }, [wait]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    if (!normalizeRuPhone(phone)) return setMsg(t('Номер — российский мобильный: +7 9XX XXX-XX-XX'));
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ sentTo: string; retryIn: number }>('/auth/phone/start', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setSentTo(r.sentTo);
      setWait(r.retryIn);
      setCode('');
      setStep('code');
    } catch (err) {
      const body = errorBody(err) as { error?: string; retryIn?: number } | null;
      if (body?.error === 'phone_code_wait' && body.retryIn) {
        setWait(body.retryIn);
        setStep('code');
      }
      setMsg(apiErrorMessage(err, t('Не удалось отправить код. Попробуйте ещё раз.')));
    } finally {
      setBusy(false);
    }
  }

  async function finish(extra: { code?: string; username?: string; pdConsent?: boolean; restore?: boolean }, withTicket = ticket) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<AuthResponse>('/auth/phone/complete', {
        method: 'POST',
        body: JSON.stringify({ ticket: withTicket, ...extra }),
      });
      setSession(r.accessToken, r.user);
      router.replace(next);
      return;
    } catch (err) {
      const body = errorBody(err) as { error?: string; suggested?: string; eraseAt?: string } | null;
      switch (body?.error) {
        case 'username_required':
          setStep('username');
          setUsername((u) => u || body.suggested || '');
          break;
        case 'username_taken':
          setMsg(body.suggested ? t('Ник занят — например, свободен {name}', { name: body.suggested }) : t('Ник занят'));
          break;
        case 'consent_required':
          setMsg(t('Без согласия на обработку персональных данных аккаунт не создать'));
          break;
        case 'two_factor_required':
          setStep('totp');
          break;
        case 'account_deleted':
          setEraseAt(body.eraseAt ?? null);
          setStep('deleted');
          break;
        case 'phone_expired':
          setStep('phone');
          setMsg(apiErrorMessage(err, t('Вход по номеру устарел — запросите код заново')));
          break;
        default:
          setMsg(apiErrorMessage(err, t('Не получилось войти. Попробуйте ещё раз.')));
      }
    }
    setBusy(false);
  }

  async function checkCode(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setMsg(t('Код — 6 цифр из SMS'));
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ ticket: string }>('/auth/phone/verify', {
        method: 'POST',
        body: JSON.stringify({ phone, code: code.trim() }),
      });
      setTicket(r.ticket);
      await finish({}, r.ticket);
    } catch (err) {
      setMsg(apiErrorMessage(err, t('Код не подошёл')));
      setBusy(false);
    }
  }

  function submitUsername(e: FormEvent) {
    e.preventDefault();
    const u = username.trim().toLowerCase();
    if (!USERNAME_RE.test(u)) return setMsg(t('Ник — строчные латинские буквы, цифры и _, от 3 символов'));
    if (!agreed) return setMsg(t('Без согласия с правилами аккаунт не создать'));
    if (!pdConsent) return setMsg(t('Без согласия на обработку персональных данных аккаунт не создать'));
    void finish({ username: u, pdConsent: true });
  }

  const error = msg && (
    <div className="alert error" role="alert">
      {msg}
    </div>
  );

  return (
    <div style={{ maxWidth: 420, margin: '56px auto', padding: '0 16px' }}>
      <h1 className="h1" style={{ fontSize: 30 }}>
        {step === 'username' ? t('Почти готово') : t('Вход по номеру телефона')}
      </h1>
      <p className="muted" style={{ margin: '8px 0 0' }}>
        {step === 'username'
          ? t('Номер подтверждён. Выберите ник — по нему вас найдут покупатели и продавцы.')
          : t('Пришлём код в SMS. Новый номер — новый аккаунт, знакомый — вход в ваш.')}
      </p>

      {enabled === false && (
        <div className="alert" role="status" style={{ marginTop: 20 }}>
          {t('Вход по телефону пока не работает — войдите по почте, через Яндекс ID или VK ID.')}{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`} style={{ color: 'var(--accent)' }}>
            {t('Ко входу')}
          </Link>
        </div>
      )}

      {enabled && step === 'phone' && (
        <form onSubmit={sendCode} className="card stack-form" style={box} noValidate>
          <div className="field">
            <label className="label" htmlFor="phone">{t('Номер телефона')}</label>
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" autoFocus
              placeholder="+7 900 000-00-00" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
            <p className="hint">{t('Только российский мобильный номер: так требует закон о входе на сайты.')}</p>
          </div>
          {error}
          <button className="btn lg block" type="submit" disabled={busy}>
            {busy ? t('Отправляем…') : t('Получить код')}
          </button>
        </form>
      )}

      {enabled && step === 'code' && (
        <form onSubmit={checkCode} className="card stack-form" style={box} noValidate>
          <div className="field">
            <label className="label" htmlFor="sms-code">
              {sentTo ? t('Код из SMS на {phone}', { phone: sentTo }) : t('Код из SMS')}
            </label>
            <input id="sms-code" className="input" autoFocus value={code} onChange={(e) => setCode(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" />
            <p className="hint">
              {wait > 0 ? (
                t('Новый код — через {n} сек.', { n: wait })
              ) : (
                <button type="button" className="link-button" disabled={busy} onClick={() => void sendCode()}>
                  {t('Отправить код ещё раз')}
                </button>
              )}
              {' · '}
              <button type="button" className="link-button" onClick={() => { setStep('phone'); setMsg(null); }}>
                {t('Другой номер')}
              </button>
            </p>
          </div>
          {error}
          <button className="btn lg block" type="submit" disabled={busy}>
            {busy ? t('Проверяем…') : t('Войти')}
          </button>
        </form>
      )}

      {step === 'totp' && (
        <form onSubmit={(e) => { e.preventDefault(); void finish({ code: totp.trim() }); }} className="card stack-form" style={box} noValidate>
          <div className="field">
            <label className="label" htmlFor="totp">{t('Код из приложения-аутентификатора')}</label>
            <input id="totp" className="input" autoFocus value={totp} onChange={(e) => setTotp(e.target.value)}
              inputMode="numeric" autoComplete="one-time-code" maxLength={20} placeholder="123456" />
            <p className="hint">{t('У аккаунта включена двухфакторная защита — она действует и при входе по номеру.')}</p>
          </div>
          {error}
          <button className="btn lg block" type="submit" disabled={busy || !totp.trim()}>
            {busy ? t('Входим…') : t('Войти')}
          </button>
        </form>
      )}

      {step === 'username' && (
        <form onSubmit={submitUsername} className="card stack-form" style={box} noValidate>
          <div className="field">
            <label className="label" htmlFor="username">{t('Ник')}</label>
            <input id="username" className="input" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={username} onChange={(e) => setUsername(e.target.value)} />
            <p className="hint">{t('Строчные латинские буквы, цифры и _, от 3 символов')}</p>
          </div>
          <label className="row muted" style={checkRow}>
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={check} />
            <span>
              {t('Мне есть 18 лет, я принимаю')}{' '}
              <Link href="/rules" style={{ color: 'var(--accent)' }}>{t('правила')}</Link> {t('и')}{' '}
              <Link href="/oferta" style={{ color: 'var(--accent)' }}>{t('оферту')}</Link>
            </span>
          </label>
          {/* Согласие на обработку ПД — отдельно от оферты (152-ФЗ, ст. 9). */}
          <label className="row muted" style={checkRow}>
            <input type="checkbox" checked={pdConsent} onChange={(e) => setPdConsent(e.target.checked)} style={check} />
            <span>
              {t('Даю')}{' '}
              <Link href="/soglasie" style={{ color: 'var(--accent)' }}>{t('согласие на обработку персональных данных')}</Link>
            </span>
          </label>
          {error}
          <button className="btn lg block" type="submit" disabled={busy}>
            {busy ? t('Создаём аккаунт…') : t('Создать аккаунт')}
          </button>
        </form>
      )}

      {step === 'deleted' && (
        <div className="card stack-form" style={box}>
          <p style={{ margin: 0 }}>
            {eraseAt
              ? t('Аккаунт удалён. До {date} его можно вернуть — лоты останутся в архиве.', {
                  date: new Date(eraseAt).toLocaleDateString(t.locale),
                })
              : t('Аккаунт удалён. Его можно вернуть в течение 30 дней после удаления.')}
          </p>
          {error}
          <button type="button" className="btn lg block" disabled={busy}
            onClick={() => void finish({ restore: true, ...(totp.trim() ? { code: totp.trim() } : {}) })}>
            {t('Восстановить аккаунт')}
          </button>
        </div>
      )}

      {step === 'phone' && (
        <p className="muted" style={{ marginTop: 20, fontSize: 14 }}>
          <Link href={`/login?next=${encodeURIComponent(next)}`} style={{ color: 'var(--accent)' }}>
            {t('Войти по почте или через сервис')}
          </Link>
        </p>
      )}
    </div>
  );
}

export default function PhoneLoginPage() {
  return (
    <Suspense>
      <PhoneLogin />
    </Suspense>
  );
}
