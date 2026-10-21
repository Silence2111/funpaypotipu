'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isStaff, useSession } from '@/lib/session';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

/** Разделы кабинета — как у FunPay: продажи, лоты, финансы и настройки отдельно. */
const LINKS = [
  { href: '/cabinet', label: msg('Обзор') },
  { href: '/cabinet/orders', label: msg('Заказы') },
  { href: '/cabinet/lots', label: msg('Мои лоты') },
  { href: '/cabinet/tools', label: msg('Инструменты') },
  { href: '/chat', label: msg('Сообщения') },
  { href: '/cabinet/favorites', label: msg('Избранное') },
  { href: '/cabinet/searches', label: msg('Поиски') },
  { href: '/cabinet/settings', label: msg('Профиль') },
  { href: '/cabinet/security', label: msg('Безопасность') },
  { href: '/cabinet/support', label: msg('Поддержка') },
];

/**
 * На телефоне — одна строка с прокруткой, а не три строки кнопок над каждой
 * страницей кабинета; текущий раздел прокручен в видимую часть.
 */
export function CabinetNav() {
  const t = useT();
  const path = usePathname();
  const { user } = useSession();
  const nav = useRef<HTMLElement>(null);
  // Сотруднику — вход в консоль: на телефоне в шапке для него нет места.
  const links = isStaff(user) ? [...LINKS, { href: '/admin', label: msg('Консоль') }] : LINKS;

  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [path]);

  return (
    <nav ref={nav} aria-label={t('Разделы кабинета')} className="row cabinet-nav">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="chip"
          aria-current={path === l.href ? 'page' : undefined}
        >
          {t(l.label)}
        </Link>
      ))}
    </nav>
  );
}
