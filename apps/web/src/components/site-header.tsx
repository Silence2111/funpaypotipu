import Link from 'next/link';
import { Gamepad2, Search } from 'lucide-react';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="container inner">
        <Link href="/" className="brand">
          <Gamepad2 size={20} strokeWidth={1.75} />
          GameMarket
        </Link>
        <nav className="nav">
          <Link href="/">Каталог</Link>
          <Link href="/#games">Игры</Link>
          <Link href="/#how">Как это работает</Link>
        </nav>
        <span className="spacer" />
        <Link href="/" className="chip" aria-label="Поиск">
          <Search size={16} strokeWidth={1.75} />
          Поиск
        </Link>
      </div>
    </header>
  );
}
