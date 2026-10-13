'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

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
  return (
    <nav aria-label="Разделы кабинета" className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {LINKS.map((l) => (
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
