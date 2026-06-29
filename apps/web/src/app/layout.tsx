import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'GameMarket — маркетплейс цифровых игровых товаров',
  description:
    'Безопасная покупка игровых аккаунтов, валюты, предметов, ключей и пополнений с защитой сделки.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
