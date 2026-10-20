'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface SocialProviders {
  google: boolean;
  vk: boolean;
  telegram: { bot: string } | null;
}

export type TelegramData = Record<string, string | number>;

/** Адрес начала входа через сервис: дальше — страница сервиса и возврат на API. */
export const oauthStart = (provider: 'google' | 'vk', next: string) =>
  `${API_URL}/api/auth/oauth/${provider}/start?next=${encodeURIComponent(next)}`;

let widgets = 0;

/**
 * Кнопка Telegram — официальный виджет входа. Данные приходят в функцию на
 * этой странице, а не в адрес: подписанные чужие данные не подсунуть
 * ссылкой. Бот — тот же, что для уведомлений; домен сайта задаётся боту в
 * BotFather (/setdomain).
 */
export function TelegramButton({
  bot,
  onAuth,
}: {
  bot: string;
  onAuth: (data: TelegramData) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onAuth);
  handler.current = onAuth;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const name = `gmTelegramAuth${++widgets}`;
    (window as unknown as Record<string, unknown>)[name] = (data: TelegramData) =>
      handler.current(data);
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.async = true;
    script.setAttribute('data-telegram-login', bot);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '12');
    script.setAttribute('data-userpic', 'false');
    // Бот сможет писать в личку — уведомления в Telegram работают сразу.
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-onauth', `${name}(user)`);
    el.appendChild(script);
    return () => {
      el.innerHTML = '';
      delete (window as unknown as Record<string, unknown>)[name];
    };
  }, [bot]);

  return <div ref={box} className="tg-login" />;
}

/**
 * Вход через Telegram, VK ID и Google под формой входа и регистрации.
 * Кнопки — только у сервисов, ключи которых заданы на сервере.
 */
export function SocialLogin({ next }: { next: string }) {
  const router = useRouter();
  const [providers, setProviders] = useState<SocialProviders | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SocialProviders>('/auth/social')
      .then(setProviders)
      .catch(() => setProviders(null));
  }, []);

  if (!providers || (!providers.google && !providers.vk && !providers.telegram)) return null;

  async function telegram(data: TelegramData) {
    setErr(null);
    try {
      await apiFetch('/auth/social/telegram', { method: 'POST', body: JSON.stringify(data) });
      router.push(`/login/social?next=${encodeURIComponent(next)}`);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Telegram не подтвердил вход. Попробуйте ещё раз.'));
    }
  }

  return (
    <div className="social-login">
      <div className="social-divider">
        <span>или</span>
      </div>
      {providers.telegram && (
        <TelegramButton bot={providers.telegram.bot} onAuth={(d) => void telegram(d)} />
      )}
      {providers.vk && (
        <a className="btn secondary block" href={oauthStart('vk', next)}>
          Войти через VK ID
        </a>
      )}
      {providers.google && (
        <a className="btn secondary block" href={oauthStart('google', next)}>
          Войти через Google
        </a>
      )}
      {err && (
        <p className="field-error" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}
