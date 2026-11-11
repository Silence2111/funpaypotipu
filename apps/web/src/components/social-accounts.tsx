'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { oauthStart, type SocialProviders } from '@/components/social-login';
import { useT } from '@/lib/i18n/client';

export interface LoginWays {
  hasPassword: boolean;
  email: string | null;
  providers: SocialProviders;
  /** Войти нечем, кроме отключённого Telegram (часть 118): нужны почта и пароль. */
  needsLoginMethod?: boolean;
  accounts: Array<{
    provider: 'yandex' | 'vk' | 'telegram';
    name: string | null;
    email: string | null;
    since: string;
    /** Старая привязка Telegram: вход через неё отключён. */
    disabled?: boolean;
  }>;
}

const ORDER = ['yandex', 'vk', 'telegram'] as const;

/**
 * Способы входа: Яндекс ID и VK ID — подключить и отключить. Сервис без
 * ключей на сервере не показывается, если он не подключён раньше.
 * Последний способ входа без пароля не отключается — сначала пароль.
 * Telegram — только старая привязка: вход через него отключён по закону
 * (часть 118), её можно убрать.
 */
export function SocialAccounts({
  ways,
  onChange,
}: {
  ways: LoginWays;
  onChange: (w: LoginWays) => void;
}) {
  const t = useT();
  // «Яндекс ID» на английском сайте — Yandex ID.
  const LABEL = { yandex: t('Яндекс ID'), vk: 'VK ID', telegram: 'Telegram' } as const;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = ORDER.filter(
    (p) => ways.accounts.some((a) => a.provider === p) || (p !== 'telegram' && ways.providers[p]),
  );
  if (!shown.length) return null;

  async function run(fn: () => Promise<LoginWays>, ok: string, fallback: string) {
    setBusy(true);
    setMsg(null);
    try {
      onChange(await fn());
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fallback) });
    } finally {
      setBusy(false);
    }
  }

  // Яндекс и VK: намерение привязать — в cookie API, потом страница сервиса.
  async function connect(provider: 'yandex' | 'vk') {
    setBusy(true);
    try {
      await apiFetch('/auth/social/link-intent', { method: 'POST' });
      window.location.href = oauthStart(provider, '/cabinet/security');
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось начать подключение.')) });
      setBusy(false);
    }
  }


  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }}>
      <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
        <Link2 size={18} strokeWidth={1.75} /> {t('Вход через сервисы')}
      </h2>
      <p className="muted" style={{ fontSize: 14, margin: '8px 0 6px' }}>
        {t('Входить в один аккаунт по паролю, через Яндекс ID или VK ID — как удобнее.')}
      </p>
      {ways.needsLoginMethod && (
        <div className="alert error" role="alert" style={{ margin: '8px 0' }}>
          {t(
            'Вход через Telegram отключён по закону (149-ФЗ, ч. 10 ст. 8). Чтобы не потерять аккаунт, пока вы в нём, добавьте почту и задайте пароль — выше на этой странице.',
          )}
        </div>
      )}
      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
          style={{ margin: '8px 0' }}
        >
          {msg.text}
        </div>
      )}
      <div className="grid" style={{ gap: 0 }}>
        {shown.map((p) => {
          const acc = ways.accounts.find((a) => a.provider === p);
          return (
            <div key={p} className="social-way">
              <span>
                <span style={{ fontWeight: 600 }}>{LABEL[p]}</span>
                <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                  {acc?.disabled
                    ? t('Вход отключён по закону · уведомления в Telegram — в настройках уведомлений')
                    : acc
                      ? `${t('Подключён')}${acc.name ? ` · ${acc.name}` : ''}${acc.email ? ` · ${acc.email}` : ''}`
                      : t('Не подключён')}
                </span>
              </span>
              {acc ? (
                <button
                  type="button"
                  className="chip"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => apiFetch<LoginWays>(`/auth/social/${p}`, { method: 'DELETE' }),
                      t('{name} отключён.', { name: LABEL[p] }),
                      t('Не удалось отключить.'),
                    )
                  }
                >
                  {acc.disabled ? t('Убрать') : t('Отключить')}
                </button>
              ) : p === 'telegram' ? null : (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void connect(p)}
                >
                  {t('Подключить')}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!ways.hasPassword && !ways.needsLoginMethod && (
        <p className="hint" style={{ marginTop: 10 }}>
          {t(
            'Пароля у аккаунта нет — вход только через сервис. Задайте пароль выше, чтобы не зависеть от него.',
          )}
        </p>
      )}
    </section>
  );
}
