import Link from 'next/link';
import { Gamepad2 } from 'lucide-react';
import { AuthNav } from './auth-nav';
import { ThemeToggle } from './theme-toggle';

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
          <Link href="/#games">Игры</Link>
          <Link href="/#how">Как это работает</Link>
        </nav>
        <span className="spacer" />
        <ThemeToggle />
        <AuthNav />
      </div>
    </header>
  );
}
