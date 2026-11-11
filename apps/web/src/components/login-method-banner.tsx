'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { KeyRound } from 'lucide-react';
import { apiFetch, useSession } from '@/lib/session';
import { useT } from '@/lib/i18n/client';

/**
 * Вход через Telegram отключён (часть 118). Кто входил только через него,
 * после выхода из аккаунта не войдёт: пока он в аккаунте — плашка на всех
 * страницах, добавить почту и пароль. Ссылка — в «Безопасность».
 */
export function LoginMethodBanner() {
  const t = useT();
  const { ready, user } = useSession();
  const path = usePathname();
  const userId = user?.id;
  const [need, setNeed] = useState(false);

  useEffect(() => {
    if (!ready || !userId) {
      setNeed(false);
      return;
    }
    apiFetch<{ needsLoginMethod?: boolean }>('/auth/social/accounts')
      .then((w) => setNeed(!!w.needsLoginMethod))
      .catch(() => {});
  }, [ready, userId, path]);

  if (!need || path === '/cabinet/security') return null;
  return (
    <div className="container" style={{ marginTop: 12 }}>
      <div className="alert error consent-banner" role="alert">
        <KeyRound size={18} strokeWidth={1.75} aria-hidden />
        <span>
          {t(
            'Вход через Telegram отключён по закону. Добавьте почту и пароль, пока вы в аккаунте, — иначе после выхода войти будет нечем.',
          )}
        </span>
        <Link href="/cabinet/security" className="btn">
          {t('Добавить почту и пароль')}
        </Link>
      </div>
    </div>
  );
}
