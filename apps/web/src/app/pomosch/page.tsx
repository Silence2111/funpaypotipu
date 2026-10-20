import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HELP_ARTICLES, HELP_GROUPS } from '@/lib/help';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Помощь'),
    description: t(
      'Как купить и продать на GameMarket: оплата, споры, комиссии, вывод денег и безопасность — коротко и с цифрами.',
    ),
    alternates: { canonical: '/pomosch' },
  };
}

/** «Помощь»: статьи для покупателя и продавца, как справка FunPay — только короче. */
export default async function HelpIndex() {
  const t = await getT();
  return (
    <div className="container" style={{ paddingTop: 48, paddingBottom: 24 }}>
      <h1 className="h1">{t('Помощь')}</h1>
      <p className="lead" style={{ maxWidth: '60ch' }}>
        {t('Как устроены покупки и продажи на GameMarket — коротко и с цифрами.')}
      </p>

      {HELP_GROUPS.map((group) => (
        <section key={group.key} className="help-group" aria-labelledby={`hg-${group.key}`}>
          <h2 className="help-group-title" id={`hg-${group.key}`}>
            {t(group.label)}
          </h2>
          <div className="help-cards">
            {HELP_ARTICLES.filter((a) => a.group === group.key).map((a) => (
              <Link key={a.slug} href={`/pomosch/${a.slug}`} className="help-card">
                <span className="help-card-title">{t(a.title)}</span>
                <span className="help-card-sum">{t(a.summary)}</span>
                <ArrowRight size={18} strokeWidth={1.75} className="help-card-go" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <div className="card flat help-more">
        <div>
          <div style={{ fontWeight: 700 }}>{t('Не нашли ответ')}</div>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
            {t('Напишите в поддержку — ответим в кабинете.')} {t('Полные условия — в')}{' '}
            <Link href="/rules" className="inline-link">
              {t('правилах')}
            </Link>
            .
          </p>
        </div>
        <Link href="/cabinet/support" className="btn secondary">
          {t('Написать в поддержку')}
        </Link>
      </div>
    </div>
  );
}
