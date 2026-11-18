import Link from 'next/link';
import { Search } from 'lucide-react';
import { AuthNav } from './auth-nav';
import { ThemeToggle } from './theme-toggle';
import { GameSearch } from './game-search';
import { getT } from '@/lib/i18n/server';

/**
 * Шапка по устройству Playerok (18.11.2026, выбор владельца «основываться на них»): серая плита,
 * в ней знак и переключатель темы, большой поиск по играм и справа кнопки со значком и подписью —
 * «Продать», «Чаты», «Профиль». Язык и валюта — в подвале, как и раньше на телефоне.
 */
export async function SiteHeader() {
  const t = await getT();
  return (
    <header className="site-header ph">
      <div className="container ph__in">
        <div className="ph__plate">
          <Link href="/" className="brand ph__brand">
            {/* eslint-disable-next-line @next/next/no-img-element -- объёмный знак, свой рендер (дизайн/3d) */}
            <img className="brand-3d" src="/3d/logo.webp" alt="" width={44} height={44} />
            Lutli
          </Link>
          <ThemeToggle />
          <div className="ph__search hide-mobile">
            <GameSearch />
          </div>
          <span className="spacer only-mobile-flex" />
          <Link href="/igry" className="ph__act only-mobile-flex" aria-label={t('Поиск по играм')}>
            <Search size={22} strokeWidth={1.9} />
          </Link>
          <nav className="ph__acts" aria-label={t('Действия')}>
            <Link href="/prodavat" className="ph__act hide-mobile">
              {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
              <img src="/3d/plus.webp" alt="" width={30} height={30} />
              <span>{t('Продать')}</span>
            </Link>
            <AuthNav />
          </nav>
        </div>
      </div>
    </header>
  );
}
