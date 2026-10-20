'use client';

import { useState } from 'react';
import { Link2 } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import {
  TelegramButton,
  oauthStart,
  type SocialProviders,
  type TelegramData,
} from '@/components/social-login';

export interface LoginWays {
  hasPassword: boolean;
  email: string | null;
  providers: SocialProviders;
  accounts: Array<{
    provider: 'google' | 'vk' | 'telegram';
    name: string | null;
    email: string | null;
    since: string;
  }>;
}

const ORDER = ['telegram', 'vk', 'google'] as const;
const LABEL = { google: 'Google', vk: 'VK ID', telegram: 'Telegram' } as const;

/**
 * Способы входа: Telegram, VK ID, Google — подключить и отключить. Сервис
 * без ключей на сервере не показывается, если он не подключён раньше.
 * Последний способ входа без пароля не отключается — сначала пароль.
 */
export function SocialAccounts({
  ways,
  onChange,
}: {
  ways: LoginWays;
  onChange: (w: LoginWays) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = ORDER.filter(
    (p) =>
      ways.accounts.some((a) => a.provider === p) ||
      (p === 'telegram' ? !!ways.providers.telegram : ways.providers[p]),
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

  // Google и VK: намерение привязать — в cookie API, потом страница сервиса.
  async function connect(provider: 'google' | 'vk') {
    setBusy(true);
    try {
      await apiFetch('/auth/social/link-intent', { method: 'POST' });
      window.location.href = oauthStart(provider, '/cabinet/security');
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, 'Не удалось начать подключение.') });
      setBusy(false);
    }
  }

  const linkTelegram = (data: TelegramData) =>
    void run(
      () =>
        apiFetch<LoginWays>('/auth/social/telegram/link', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      'Telegram подключён: теперь можно входить через него.',
      'Telegram не подключился.',
    );

  return (
    <section className="card" style={{ padding: 24, maxWidth: 600 }}>
      <h2 className="h2 row" style={{ fontSize: 18, gap: 8 }}>
        <Link2 size={18} strokeWidth={1.75} /> Вход через сервисы
      </h2>
      <p className="muted" style={{ fontSize: 14, margin: '8px 0 6px' }}>
        Входить в один аккаунт по паролю, через Telegram, VK ID или Google — как удобнее.
      </p>
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
                  {acc
                    ? `Подключён${acc.name ? ` · ${acc.name}` : ''}${acc.email ? ` · ${acc.email}` : ''}`
                    : 'Не подключён'}
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
                      `${LABEL[p]} отключён.`,
                      'Не удалось отключить.',
                    )
                  }
                >
                  Отключить
                </button>
              ) : p === 'telegram' ? (
                ways.providers.telegram && (
                  <TelegramButton bot={ways.providers.telegram.bot} onAuth={linkTelegram} />
                )
              ) : (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void connect(p)}
                >
                  Подключить
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!ways.hasPassword && (
        <p className="hint" style={{ marginTop: 10 }}>
          Пароля у аккаунта нет — вход только через сервис. Задайте пароль выше, чтобы не зависеть
          от него.
        </p>
      )}
    </section>
  );
}
