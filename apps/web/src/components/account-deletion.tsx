'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { clearSession } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface DeletionStatus {
  blockers: { orders: number; disputes: number; balance: string; payouts: number; staff: boolean };
  canDelete: boolean;
  /** Остаток меньше вывода, копейки строкой: сгорит при удалении. */
  forfeit: string;
  needsPassword: boolean;
  needsCode: boolean;
  graceDays: number;
}

/**
 * Удаление аккаунта (часть 124): что мешает — со ссылками, куда идти;
 * подтверждение ником, паролем и кодом. После удаления — выход и страница
 * с датой: до неё аккаунт можно вернуть входом.
 */
export function AccountDeletion() {
  const t = useT();
  const [s, setS] = useState<DeletionStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [forfeit, setForfeit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<DeletionStatus>('/account/deletion')
      .then(setS)
      .catch(() => {});
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch<{ eraseAt: string }>('/account/deletion', {
        method: 'POST',
        body: JSON.stringify({
          username: username.trim(),
          ...(s?.needsPassword ? { password } : {}),
          ...(s?.needsCode && code.trim() ? { code: code.trim() } : {}),
          ...(forfeit ? { forfeit: true } : {}),
        }),
      });
      // Сеансы на сервере уже закрыты — стираем вход в браузере и уходим
      // на главную целиком: шапка должна забыть вход.
      clearSession();
      window.location.assign(`/?deleted=${encodeURIComponent(res.eraseAt.slice(0, 10))}`);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не получилось удалить аккаунт. Попробуйте ещё раз.')));
      setBusy(false);
    }
  }

  if (!s) return null;
  const b = s.blockers;
  const left = BigInt(s.forfeit);
  const reasons = [
    b.orders > 0 && { text: t('Сделок в работе: {n}', { n: b.orders }), href: '/cabinet/orders', link: t('Заказы') },
    b.disputes > 0 && { text: t('Открытых споров: {n}', { n: b.disputes }), href: '/cabinet/disputes', link: t('Споры') },
    !s.canDelete && BigInt(b.balance) > 0n && {
      text: t('На балансе {sum} — выведите их', { sum: formatPrice(b.balance, 'RUB', t) }),
      href: '/cabinet/wallet',
      link: t('Кошелёк'),
    },
    b.payouts > 0 && { text: t('Заявок на вывод в работе: {n}', { n: b.payouts }), href: '/cabinet/wallet', link: t('Кошелёк') },
    b.staff && { text: t('Вы сотрудник площадки — роль сначала снимает администратор'), href: '/cabinet/support', link: t('Поддержка') },
  ].filter(Boolean) as Array<{ text: string; href: string; link: string }>;

  return (
    <section style={{ maxWidth: 600 }} aria-labelledby="delete-title">
      <h2 className="h2" id="delete-title" style={{ fontSize: 18, marginBottom: 6 }}>
        {t('Удалить аккаунт')}
      </h2>
      <p className="muted" style={{ margin: '0 0 12px', fontSize: 14 }}>
        {t(
          'Лоты уйдут из каталога, вход закроется. {days} дней аккаунт можно вернуть входом, потом почта, имя, вход и реквизиты уничтожаются. Сделки и движение денег остаются — без них не исполнить закон и не разобрать спор, ник в них станет «deleted_…».',
          { days: s.graceDays },
        )}
      </p>
      {reasons.length > 0 ? (
        <div className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>{t('Сначала доведите до конца:')}</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            {reasons.map((r) => (
              <li key={r.text}>
                {r.text} ·{' '}
                <Link href={r.href} style={{ color: 'var(--accent)' }}>
                  {r.link}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : !open ? (
        <button type="button" className="chip" onClick={() => setOpen(true)}>
          {t('Удалить аккаунт')}
        </button>
      ) : (
        <form className="card stack-form" style={{ padding: 16, gap: 12 }} onSubmit={submit}>
          <div className="field">
            <label className="label" htmlFor="del-username">
              {t('Впишите свой ник — это защита от случайного нажатия')}
            </label>
            <input id="del-username" className="input" value={username} onChange={(e) => setUsername(e.target.value)}
              autoComplete="off" autoCapitalize="none" spellCheck={false} required />
          </div>
          {s.needsPassword && (
            <div className="field">
              <label className="label" htmlFor="del-password">{t('Пароль')}</label>
              <input id="del-password" className="input" type="password" value={password}
                onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            </div>
          )}
          {s.needsCode && (
            <div className="field">
              <label className="label" htmlFor="del-code">{t('Код из приложения-аутентификатора')}</label>
              <input id="del-code" className="input" value={code} onChange={(e) => setCode(e.target.value)}
                inputMode="numeric" autoComplete="one-time-code" maxLength={20} required />
            </div>
          )}
          {left > 0n && (
            <label className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
              <input type="checkbox" checked={forfeit} onChange={(e) => setForfeit(e.target.checked)} required />
              <span>
                {t('На балансе {sum} — меньше минимального вывода. Понимаю, что при удалении они сгорят.', {
                  sum: formatPrice(s.forfeit, 'RUB', t),
                })}
              </span>
            </label>
          )}
          {err && (
            <div className="alert error" role="alert">
              {err}
            </div>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn danger" type="submit" disabled={busy || !username.trim()}>
              {busy ? t('Удаляем…') : t('Удалить аккаунт')}
            </button>
            <button className="chip" type="button" onClick={() => setOpen(false)}>
              {t('Отмена')}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
