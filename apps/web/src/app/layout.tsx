import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: 'GameMarket — маркетплейс цифровых игровых товаров',
  description:
    'Безопасная покупка игровых аккаунтов, валюты, предметов, ключей и пополнений с защитой сделки.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <footer className="container" style={{ padding: '64px 24px 48px', marginTop: 64 }}>
          <hr className="divider" style={{ marginBottom: 24 }} />
          <p className="faint" style={{ fontSize: 13 }}>
            © {new Date().getFullYear()} GameMarket · Фаза 1 · эскроу-защита сделки
          </p>
        </footer>
      </body>
    </html>
  );
}
