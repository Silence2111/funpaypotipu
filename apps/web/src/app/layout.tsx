import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { CurrencySwitch } from '@/components/currency-switch';
import { InstallApp } from '@/components/install-app';
import { PwaRegister } from '@/components/pwa-register';
import { SiteHeader } from '@/components/site-header';
import { TabBar } from '@/components/tab-bar';
import { LangSwitch } from '@/components/lang-switch';
import { LangProvider } from '@/lib/i18n/client';
import { dictOf, getLang, getT } from '@/lib/i18n/server';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('GameMarket — маркетплейс цифровых игровых товаров'),
      template: '%s · GameMarket',
    },
    description: t(
      'Безопасная покупка игровых аккаунтов, валюты, предметов, ключей и пополнений с защитой сделки (эскроу).',
    ),
    openGraph: {
      type: 'website',
      siteName: 'GameMarket',
      locale: t.lang === 'en' ? 'en_US' : 'ru_RU',
    },
    robots: { index: true, follow: true },
    // С экрана «Домой» на iPhone — без адресной строки, как приложение.
    appleWebApp: { capable: true, title: 'GameMarket', statusBarStyle: 'default' },
  };
}

// Цвет строки состояния и панели браузера — как у шапки сайта.
export const viewport: Viewport = {
  // Отступы под «чёлку» и полоску «Домой» — у нижней панели и шапки.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#121317' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = await getT();
  return (
    <html lang={lang}>
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
        <LangProvider lang={lang} dict={dictOf(lang)}>
        <PwaRegister />
        <SiteHeader />
        <main>{children}</main>
        <footer className="container" style={{ padding: '48px 24px 40px', marginTop: 64 }}>
          <hr className="divider" style={{ marginBottom: 20 }} />
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>
              © {new Date().getFullYear()} GameMarket · {t('лоты с пометкой «Пример» — демонстрационные')}
            </p>
            <nav className="row faint" style={{ gap: '0 16px', fontSize: 13, flexWrap: 'wrap' }} aria-label={t('Документы')}>
              <Link href="/pomosch" className="footer-link">{t('Помощь')}</Link>
              <Link href="/rules" className="footer-link">{t('Правила и гарантии')}</Link>
              <Link href="/oferta" className="footer-link">{t('Оферта')}</Link>
              <Link href="/privacy" className="footer-link">{t('Персональные данные')}</Link>
              <Link href="/contacts" className="footer-link">{t('Контакты')}</Link>
              <Link href="/podbor" className="footer-link">{t('Как мы меряем выдачу')}</Link>
            </nav>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <InstallApp />
              {/* На телефоне в шапке нет места — язык и валюта цен здесь, для всех ширин */}
              <LangSwitch label />
              <CurrencySwitch label={t('Валюта цен')} />
            </div>
          </div>
        </footer>
        <TabBar />
        </LangProvider>
      </body>
    </html>
  );
}
