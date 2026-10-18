'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isStaff, useSession } from '@/lib/session';

/** Разделы кабинета — как у FunPay: продажи, лоты, финансы и настройки отдельно. */
const LINKS = [
  { href: '/cabinet', label: 'Обзор' },
  { href: '/cabinet/orders', label: 'Заказы' },
  { href: '/cabinet/lots', label: 'Мои лоты' },
  { href: '/chat', label: 'Сообщения' },
  { href: '/cabinet/favorites', label: 'Избранное' },
  { href: '/cabinet/settings', label: 'Профиль' },
  { href: '/cabinet/security', label: 'Безопасность' },
  { href: '/cabinet/support', label: 'Поддержка' },
];

/**
 * На телефоне — одна строка с прокруткой, а не три строки кнопок над каждой
 * страницей кабинета; текущий раздел прокручен в видимую часть.
 */
export function CabinetNav() {
  const path = usePathname();
  const { user } = useSession();
  const nav = useRef<HTMLElement>(null);
  // Сотруднику — вход в консоль: на телефоне в шапке для него нет места.
  const links = isStaff(user) ? [...LINKS, { href: '/admin', label: 'Консоль' }] : LINKS;

  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [path]);

  return (
    <nav ref={nav} aria-label="Разделы кабинета" className="row cabinet-nav">
      {links.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="chip"
          aria-current={path === l.href ? 'page' : undefined}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}
