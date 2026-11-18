import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Gamepad2 } from 'lucide-react';
import { CurrencySwitch } from '@/components/currency-switch';
import { InstallApp } from '@/components/install-app';
import { PwaRegister } from '@/components/pwa-register';
import { PartnerRef } from '@/components/partner-ref';
import { ConsentBanner } from '@/components/consent';
import { LoginMethodBanner } from '@/components/login-method-banner';
import { SiteHeader } from '@/components/site-header';
import { TabBar } from '@/components/tab-bar';
import { DisputeBanner } from '@/components/dispute-banner';
import { LangSwitch } from '@/components/lang-switch';
import { ErrorReporter } from '@/components/error-reporter';
import { Metrika } from '@/components/metrika';
import { getPublicPricing } from '@/lib/api';
import { LangProvider } from '@/lib/i18n/client';
import { dictOf, getLang, getT } from '@/lib/i18n/server';
// Inter со своего сервера (@fontsource): Google Fonts из России грузится через раз и передаёт
// IP посетителя за границу (152-ФЗ). Кириллица — в тех же файлах, по unicode-range.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import './globals.css';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      default: t('GameMarket, маркетплейс цифровых игровых товаров'),
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
  const [lang, t, pricing] = await Promise.all([getLang(), getT(), getPublicPricing()]);
  return (
    <html lang={lang}>
      <head>
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
        <ErrorReporter />
        <PartnerRef />
        <SiteHeader />
        <DisputeBanner />
        <ConsentBanner />
        <LoginMethodBanner />
        <main>{children}</main>
        {/* Подвал колонками: кому что нужно (покупателю, продавцу, документы); внизу копирайт, язык, валюта. */}
        <footer className="site-footer">
          <div className="container site-footer__grid">
            <div className="site-footer__brand">
              <Link href="/" className="brand">
                <span className="brand-mark" aria-hidden>
                  <Gamepad2 size={18} strokeWidth={2} />
                </span>
                GameMarket
              </Link>
              <p>
                {t('Аккаунты, валюта, предметы, ключи и донат.')}{' '}
                {t('Деньги лежат у площадки, пока вы не подтвердите, что получили товар.')}
              </p>
            </div>
            <nav aria-label={t('Покупателям')}>
              <b>{t('Покупателям')}</b>
              <Link href="/catalog">{t('Каталог')}</Link>
              <Link href="/igry">{t('Все игры')}</Link>
              <Link href="/pomosch">{t('Помощь')}</Link>
              <Link href="/rules">{t('Правила и гарантии')}</Link>
            </nav>
            <nav aria-label={t('Продавцам')}>
              <b>{t('Продавцам')}</b>
              <Link href="/prodavat">{t('Продавать на GameMarket')}</Link>
              <Link href="/prodavat/api">{t('API для продавцов')}</Link>
              <Link href="/podbor">{t('Как мы меряем выдачу')}</Link>
              <Link href="/prilozhenie">{t('Приложение')}</Link>
            </nav>
            <nav aria-label={t('Документы')}>
              <b>{t('Документы')}</b>
              <Link href="/oferta">{t('Оферта')}</Link>
              <Link href="/privacy">{t('Персональные данные')}</Link>
              <Link href="/contacts">{t('Контакты')}</Link>
            </nav>
            <div className="site-footer__bottom">
              <p>
                © {new Date().getFullYear()} GameMarket
                {/* Только на демо-стенде: на настоящем запуске демо-лотов нет. */}
                {pricing?.paymentsDemo && <> · {t('лоты с пометкой «Пример» демонстрационные')}</>}
              </p>
              <div className="site-footer__tools">
                <InstallApp />
                {/* На телефоне в шапке нет места — язык и валюта цен здесь, для всех ширин */}
                <LangSwitch label />
                <CurrencySwitch label={t('Валюта цен')} />
              </div>
            </div>
          </div>
        </footer>
        <TabBar />
        <Metrika />
        </LangProvider>
      </body>
    </html>
  );
}
