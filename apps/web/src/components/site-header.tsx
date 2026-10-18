import Link from 'next/link';
import { Gamepad2, Search } from 'lucide-react';
import { AuthNav } from './auth-nav';
import { ThemeToggle } from './theme-toggle';
import { CurrencySwitch } from './currency-switch';
import { GameSearch } from './game-search';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href="/" className="brand">
          <Gamepad2 size={20} strokeWidth={1.75} />
          GameMarket
        </Link>
        <nav className="nav">
          <Link href="/catalog">Каталог</Link>
          <Link href="/cabinet/new" className="hide-mobile">Продать</Link>
          <Link href="/rules" className="hide-mobile">Гарантии</Link>
        </nav>
        {/* Поиск по играм, как «Поиск по 885 играм» в шапке FunPay. На телефоне
            места нет — там лупа ведёт в указатель игр с тем же поиском. */}
        <div className="header-search hide-mobile">
          <GameSearch />
        </div>
        <span className="spacer" />
        <Link href="/igry" className="chip only-mobile-flex" aria-label="Поиск по играм">
          <Search size={16} strokeWidth={1.75} />
        </Link>
        <CurrencySwitch className="hide-mobile" />
        <ThemeToggle />
        <AuthNav />
      </div>
    </header>
  );
}
