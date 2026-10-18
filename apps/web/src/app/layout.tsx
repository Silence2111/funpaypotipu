import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { CurrencySwitch } from '@/components/currency-switch';
import { InstallApp } from '@/components/install-app';
import { PwaRegister } from '@/components/pwa-register';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'GameMarket — маркетплейс цифровых игровых товаров',
    template: '%s · GameMarket',
  },
  description:
    'Безопасная покупка игровых аккаунтов, валюты, предметов, ключей и пополнений с защитой сделки (эскроу).',
  openGraph: {
    type: 'website',
    siteName: 'GameMarket',
    locale: 'ru_RU',
  },
  robots: { index: true, follow: true },
  // С экрана «Домой» на iPhone — без адресной строки, как приложение.
  appleWebApp: { capable: true, title: 'GameMarket', statusBarStyle: 'default' },
};

// Цвет строки состояния и панели браузера — как у шапки сайта.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#121317' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}",
          }}
        />
        <PwaRegister />
        <SiteHeader />
        <main>{children}</main>
        <footer className="container" style={{ padding: '48px 24px 40px', marginTop: 64 }}>
          <hr className="divider" style={{ marginBottom: 20 }} />
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>
              © {new Date().getFullYear()} GameMarket · лоты с пометкой «Пример» — демонстрационные
            </p>
            <nav className="row faint" style={{ gap: '0 16px', fontSize: 13, flexWrap: 'wrap' }} aria-label="Документы">
              <a href="/rules" className="footer-link">Правила и гарантии</a>
              <a href="/oferta" className="footer-link">Оферта</a>
              <a href="/privacy" className="footer-link">Персональные данные</a>
              <a href="/contacts" className="footer-link">Контакты</a>
              <a href="/podbor" className="footer-link">Как мы меряем выдачу</a>
            </nav>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <InstallApp />
              {/* На телефоне в шапке нет места — валюта цен здесь, для всех ширин */}
              <CurrencySwitch label="Валюта цен" />
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
