'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { apiFetch, isStaff, useSession } from '@/lib/session';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

/**
 * Разделы кабинета по группам, как боковое меню Ozon и Авито: раньше 17 кнопок стояли
 * двумя рядами над каждой страницей вперемешку (покупки, продажи, деньги, настройки).
 */
const GROUPS: Array<{ key: string; title?: string; links: Array<{ href: string; label: string }> }> = [
  { key: 'home', links: [{ href: '/cabinet', label: msg('Обзор') }] },
  {
    key: 'buy',
    title: msg('Покупки'),
    links: [
      { href: '/cabinet/orders', label: msg('Заказы') },
      { href: '/cabinet/favorites', label: msg('Избранное') },
      { href: '/cabinet/searches', label: msg('Поиски') },
      { href: '/cabinet/requests', label: msg('Запросы') },
      { href: '/cabinet/following', label: msg('Подписки') },
    ],
  },
  {
    key: 'sell',
    title: msg('Продажи'),
    links: [
      { href: '/cabinet/lots', label: msg('Мои лоты') },
      { href: '/cabinet/tools', label: msg('Инструменты') },
      { href: '/cabinet/reviews', label: msg('Отзывы') },
    ],
  },
  { key: 'money',
    title: msg('Деньги'), links: [{ href: '/cabinet/wallet', label: msg('Кошелёк') }] },
  {
    key: 'talk',
    title: msg('Общение'),
    links: [
      { href: '/chat', label: msg('Сообщения') },
      { href: '/cabinet/notifications', label: msg('Уведомления') },
      { href: '/cabinet/disputes', label: msg('Споры') },
      { href: '/cabinet/support', label: msg('Поддержка') },
    ],
  },
  {
    key: 'account',
    title: msg('Аккаунт'),
    links: [
      { href: '/cabinet/settings', label: msg('Профиль') },
      { href: '/cabinet/security', label: msg('Безопасность') },
    ],
  },
];

/** Работает ли партнёрская программа — один запрос на вкладку браузера. */
let partnerProgram: Promise<boolean> | null = null;
const partnerActive = () =>
  (partnerProgram ??= apiFetch<{ active: boolean }>('/partners/program')
    .then((p) => p.active)
    .catch(() => false));

/**
 * На телефоне — одна строка с прокруткой, а не три строки кнопок над каждой
 * страницей кабинета; текущий раздел прокручен в видимую часть.
 */
export function CabinetNav() {
  const t = useT();
  const path = usePathname();
  const { user } = useSession();
  const nav = useRef<HTMLElement>(null);
  // «Партнёрам» — пока программа работает (часть 116): выключенная — лишняя кнопка.
  const [partner, setPartner] = useState(false);
  useEffect(() => {
    void partnerActive().then(setPartner);
  }, []);
  // «Партнёрам» — к продажам, «Консоль» сотрудника — к аккаунту (на телефоне в шапке для неё нет места).
  const groups = GROUPS.map((g) => {
    if (g.key === 'sell' && (partner || path === '/cabinet/partner'))
      return { ...g, links: [...g.links, { href: '/cabinet/partner', label: msg('Партнёрам') }] };
    if (g.key === 'account' && isStaff(user)) return { ...g, links: [...g.links, { href: '/admin', label: msg('Консоль') }] };
    return g;
  });

  useEffect(() => {
    nav.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [path]);

  return (
    <nav ref={nav} aria-label={t('Разделы кабинета')} className="cab-nav">
      {groups.map((g) => (
        <div key={g.key} className="cab-nav__g">
          {g.title && <span className="cab-nav__t">{t(g.title)}</span>}
          {g.links.map((l) => (
            <Link key={l.href} href={l.href} aria-current={path === l.href ? 'page' : undefined}>
              {t(l.label)}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
