'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isStaff, useSession } from '@/lib/session';

/** Разделы кабинета — как у FunPay: продажи, лоты, финансы и настройки отдельно. */
const LINKS = [
  { href: '/cabinet', label: 'Обзор' },
  { href: '/cabinet/orders', label: 'Заказы' },
  { href: '/cabinet/lots', label: 'Мои лоты' },
  { href: '/cabinet/chats', label: 'Диалоги' },
  { href: '/cabinet/favorites', label: 'Избранное' },
  { href: '/cabinet/security', label: 'Безопасность' },
];

export function CabinetNav() {
  const path = usePathname();
  const { user } = useSession();
  // Сотруднику — вход в консоль: на телефоне в шапке для него нет места.
  const links = isStaff(user) ? [...LINKS, { href: '/admin', label: 'Консоль' }] : LINKS;
  return (
    <nav aria-label="Разделы кабинета" className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
