'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export interface SocialProviders {
  yandex: boolean;
  vk: boolean;
  /** Всегда null: вход через Telegram убран (часть 118). */
  telegram: null;
}

/** Адрес начала входа через сервис: дальше — страница сервиса и возврат на API. */
export const oauthStart = (provider: 'yandex' | 'vk', next: string) =>
  `${API_URL}/api/auth/oauth/${provider}/start?next=${encodeURIComponent(next)}`;

/**
 * Вход через Яндекс ID и VK ID под формой входа и регистрации. Кнопки —
 * только у сервисов, ключи которых заданы на сервере. Telegram убран:
 * его нет в перечне способов входа ч. 10 ст. 8 149-ФЗ (часть 118).
 */
export function SocialLogin({ next }: { next: string }) {
  const t = useT();
  const [providers, setProviders] = useState<SocialProviders | null>(null);

  useEffect(() => {
    apiFetch<SocialProviders>('/auth/social')
      .then(setProviders)
      .catch(() => setProviders(null));
  }, []);

  if (!providers || (!providers.yandex && !providers.vk)) return null;

  return (
    <div className="social-login">
      <div className="social-divider">
        <span>{t('или')}</span>
      </div>
      {providers.yandex && (
        <a className="btn secondary block" href={oauthStart('yandex', next)}>
          {t('Войти через Яндекс ID')}
        </a>
      )}
      {providers.vk && (
        <a className="btn secondary block" href={oauthStart('vk', next)}>
          {t('Войти через VK ID')}
        </a>
      )}
    </div>
  );
}
