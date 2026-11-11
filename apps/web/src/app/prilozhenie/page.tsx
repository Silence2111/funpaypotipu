import type { Metadata } from 'next';
import Link from 'next/link';
import { getT } from '@/lib/i18n/server';
import { IosInstallSteps } from '@/components/ios-install-steps';

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
/** Ссылки на магазины — когда приложение опубликовано аккаунтами владельца (apps/android/README.md). */
const GOOGLE_PLAY = process.env.NEXT_PUBLIC_GOOGLE_PLAY_URL;
const RUSTORE = process.env.NEXT_PUBLIC_RUSTORE_URL;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Приложение GameMarket'),
    description: t('GameMarket на телефоне: Android — Google Play и RuStore, iPhone — с экрана «Домой». Уведомления о заказах и сообщениях.'),
    alternates: { canonical: `${SITE}/prilozhenie` },
  };
}

/**
 * Приложение (часть 139): Android — оболочка сайта в Google Play и RuStore
 * (ссылки появятся, когда владелец опубликует); iPhone — сайт на экране
 * «Домой» с пушами. Одно приложение — тот же сайт, обновляется вместе с ним.
 */
export default async function AppPage() {
  const t = await getT();
  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 720 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Приложение GameMarket')}</h1>
        <p className="lead">{t('Заказы, сообщения и уведомления — с иконки на телефоне, без адресной строки.')}</p>
      </div>

      <section className="card" style={{ padding: 24, display: 'grid', gap: 12 }}>
        <h2 className="h2" style={{ fontSize: 20, margin: 0 }}>Android</h2>
        {GOOGLE_PLAY || RUSTORE ? (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {GOOGLE_PLAY && <a className="btn" href={GOOGLE_PLAY} rel="noopener">Google Play</a>}
            {RUSTORE && <a className="btn secondary" href={RUSTORE} rel="noopener">RuStore</a>}
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>
            {t('Скоро в Google Play и RuStore. Пока — установите с сайта: откройте GameMarket в Chrome и нажмите «Установить приложение» внизу страницы или в меню браузера.')}
          </p>
        )}
      </section>

      <section className="card" style={{ padding: 24, display: 'grid', gap: 14 }}>
        <h2 className="h2" style={{ fontSize: 20, margin: 0 }}>iPhone</h2>
        <IosInstallSteps />
        <p className="hint" style={{ margin: 0 }}>
          {t('iPhone присылает уведомления только сайтам с экрана «Домой» — без установки пушей не будет.')}{' '}
          <Link href="/cabinet/settings" style={{ color: 'var(--accent)' }}>{t('Настройки уведомлений')}</Link>
        </p>
      </section>
    </div>
  );
}
