import Link from 'next/link';
import { Gamepad2, Search } from 'lucide-react';
import { AuthNav } from './auth-nav';
import { ThemeToggle } from './theme-toggle';
import { CurrencySwitch } from './currency-switch';
import { GameSearch } from './game-search';
import { LangSwitch } from './lang-switch';
import { getT } from '@/lib/i18n/server';

export async function SiteHeader() {
  const t = await getT();
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href="/" className="brand">
          <Gamepad2 size={20} strokeWidth={1.75} />
          GameMarket
        </Link>
        <nav className="nav">
          <Link href="/catalog" className="hide-mobile">{t('Каталог')}</Link>
          {/* «Продать» — страница с калькулятором и кнопкой «Выставить лот»: продавец,
              который пришёл посмотреть, видит, сколько получит, до регистрации. */}
          <Link href="/prodavat" className="hide-mobile">{t('Продать')}</Link>
        </nav>
        {/* Поиск по играм, как «Поиск по 885 играм» в шапке FunPay. На телефоне
            места нет — там лупа ведёт в указатель игр с тем же поиском. */}
        <div className="header-search hide-mobile">
          <GameSearch />
        </div>
        <span className="spacer" />
        <Link href="/igry" className="chip only-mobile-flex" aria-label={t('Поиск по играм')}>
          <Search size={16} strokeWidth={1.75} />
        </Link>
        <LangSwitch className="hide-mobile" />
        <CurrencySwitch className="hide-mobile" />
        <ThemeToggle />
        <AuthNav />
      </div>
    </header>
  );
}
