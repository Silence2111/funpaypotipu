import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { CurrencySwitch } from '@/components/currency-switch';
import { InstallApp } from '@/components/install-app';
import { PwaRegister } from '@/components/pwa-register';
import { PartnerRef } from '@/components/partner-ref';
import { ConsentBanner } from '@/components/consent';
import { LoginMethodBanner } from '@/components/login-method-banner';
import { SiteHeader } from '@/components/site-header';
import { LiveFx } from '@/components/live-fx';
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
import './pk.css';

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
    // suppressHydrationWarning: тема ставится скриптом до React, иначе Next ругается «1 Issue»
    <html lang={lang} suppressHydrationWarning>
      <head>
      </head>
      <body>
        <script
          dangerouslySetInnerHTML={{
            __html:
              "document.documentElement.classList.add('fx');try{var t=localStorage.getItem('theme');if(t)document.documentElement.setAttribute('data-theme',t);}catch(e){}",
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
        <LiveFx />
        {/* Подвал колонками: кому что нужно (покупателю, продавцу, документы); внизу копирайт, язык, валюта. */}
        <footer className="site-footer">
          <div className="container site-footer__grid">
            <div className="site-footer__brand">
              <Link href="/" className="brand">
                {/* eslint-disable-next-line @next/next/no-img-element -- объёмный знак, свой рендер (дизайн/3d) */}
            <img className="brand-3d" src="/3d/logo.webp" alt="" width={44} height={44} />
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
            {/* Способы оплаты значками, как подвал Playerok и Eneba: только то, что площадка принимает */}
            {pricing?.payMethods && pricing.payMethods.length > 0 && (
              <div className="pay-row" aria-label={t('Способы оплаты')}>
                {pricing.payMethods.includes('sbp') && <span className="pay-b pay-b--txt">{t('СБП')}</span>}
                {pricing.payMethods.includes('card') && (
                  <>
                    <span className="pay-b pay-b--txt pay-b--mir">{t('МИР')}</span>
                    <span className="pay-b" style={{ ['--i' as string]: 'url(/pay/c-visa.svg)' }} aria-label="Visa" />
                    <span className="pay-b" style={{ ['--i' as string]: 'url(/pay/c-mastercard.svg)' }} aria-label="Mastercard" />
                  </>
                )}
                {pricing.payMethods.includes('applepay') && <span className="pay-b" style={{ ['--i' as string]: 'url(/pay/c-applepay.svg)' }} aria-label="Apple Pay" />}
                {pricing.payMethods.includes('googlepay') && <span className="pay-b" style={{ ['--i' as string]: 'url(/pay/c-googlepay.svg)' }} aria-label="Google Pay" />}
                {pricing.payMethods.some((m) => m === 'crypto' || m === 'usdt') && (
                  <span className="pay-b" style={{ ['--i' as string]: 'url(/pay/c-tether.svg)' }} aria-label="USDT" />
                )}
                <Link href="/pomosch" className="pay-help">
                  {t('Написать в поддержку')}
                </Link>
              </div>
            )}
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
