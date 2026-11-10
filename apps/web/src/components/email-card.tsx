'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Mail } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Почта» в «Безопасности»: сменить или добавить. Почта — ключ от аккаунта,
 * поэтому просят пароль (если он есть) и код из приложения (если включён);
 * сменится, когда откроют ссылку на новой почте. Прежней почте — письмо со
 * ссылкой «Это не я» на 7 дней.
 */
export function EmailCard({ email, hasPassword }: { email: string | null; hasPassword: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [twoFactor, setTwoFactor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<{ enabled: boolean }>('/auth/2fa')
      .then((s) => setTwoFactor(s.enabled))
      .catch(() => setTwoFactor(false));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const to = next.trim();
      await apiFetch('/auth/email', {
        method: 'POST',
        body: JSON.stringify({
          email: to,
          ...(hasPassword ? { password } : {}),
          ...(twoFactor ? { code } : {}),
        }),
      });
      setMsg({ ok: true, text: t('Письмо со ссылкой ушло на {email}. Откройте его, чтобы подтвердить, — ссылка действует сутки.', { email: to }) });
      setOpen(false);
      setNext('');
      setPassword('');
      setCode('');
    } catch (e2) {
      setMsg({ ok: false, text: apiErrorMessage(e2, t('Не удалось сменить почту.')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }} aria-labelledby="email-title">
      <h2 id="email-title" className="h2 row" style={{ fontSize: 18, gap: 8 }}>
        <Mail size={18} strokeWidth={1.75} /> {t('Почта')}
      </h2>
      <p style={{ margin: '12px 0 0' }}>
        {email ? <span style={{ fontWeight: 600 }}>{email}</span> : <span className="muted">{t('Почты у аккаунта нет — он заведён через сервис.')}</span>}
      </p>
      {msg && (
        <p role={msg.ok ? 'status' : 'alert'} style={{ margin: '12px 0 0', fontSize: 14, color: msg.ok ? undefined : 'var(--danger)' }}>
          {msg.text}
        </p>
      )}
      {open ? (
        <form onSubmit={submit} className="stack-form" style={{ gap: 14, marginTop: 14 }}>
          <div className="field">
            <label className="label" htmlFor="em-next">{t('Новая почта')}</label>
            <input id="em-next" className="input" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false}
              value={next} required onChange={(e) => setNext(e.target.value)} />
          </div>
          {hasPassword && (
            <div className="field">
              <label className="label" htmlFor="em-pwd">{t('Текущий пароль')}</label>
              <input id="em-pwd" className="input" type="password" autoComplete="current-password"
                value={password} required onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          {twoFactor && (
            <div className="field">
              <label className="label" htmlFor="em-code">{t('Код из приложения')}</label>
              <input id="em-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={20}
                style={{ fontFamily: "'JetBrains Mono', ui-monospace, monospace" }}
                value={code} required onChange={(e) => setCode(e.target.value)} />
            </div>
          )}
          <p className="hint" style={{ margin: 0 }}>
            {email
              ? t('На новую почту придёт ссылка для подтверждения, на прежнюю — письмо со ссылкой «Это не я»: 7 дней её можно вернуть.')
              : t('На почту придёт ссылка для подтверждения. С почтой можно входить по паролю и восстановить доступ.')}
          </p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={busy || !next.trim()}>
              {busy ? '…' : t('Отправить ссылку')}
            </button>
            <button className="btn secondary" type="button" onClick={() => setOpen(false)}>{t('Отмена')}</button>
          </div>
        </form>
      ) : (
        <div style={{ marginTop: 14 }}>
          <button className="btn secondary" type="button" onClick={() => { setOpen(true); setMsg(null); }}>
            {email ? t('Сменить почту') : t('Добавить почту')}
          </button>
        </div>
      )}
    </section>
  );
}
