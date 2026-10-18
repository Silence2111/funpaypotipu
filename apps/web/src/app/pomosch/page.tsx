import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { HELP_ARTICLES, HELP_GROUPS } from '@/lib/help';

export const metadata: Metadata = {
  title: 'Помощь',
  description: 'Как купить и продать на GameMarket: оплата, споры, комиссии, вывод денег и безопасность — коротко и с цифрами.',
  alternates: { canonical: '/pomosch' },
};

/** «Помощь»: статьи для покупателя и продавца, как справка FunPay — только короче. */
export default function HelpIndex() {
  return (
    <div className="container" style={{ paddingTop: 48, paddingBottom: 24 }}>
      <h1 className="h1">Помощь</h1>
      <p className="lead" style={{ maxWidth: '60ch' }}>
        Как устроены покупки и продажи на GameMarket — коротко и с цифрами.
      </p>

      {HELP_GROUPS.map((group) => (
        <section key={group} className="help-group" aria-labelledby={`hg-${group}`}>
          <h2 className="help-group-title" id={`hg-${group}`}>
            {group}
          </h2>
          <div className="help-cards">
            {HELP_ARTICLES.filter((a) => a.group === group).map((a) => (
              <Link key={a.slug} href={`/pomosch/${a.slug}`} className="help-card">
                <span className="help-card-title">{a.title}</span>
                <span className="help-card-sum">{a.summary}</span>
                <ArrowRight size={18} strokeWidth={1.75} className="help-card-go" aria-hidden />
              </Link>
            ))}
          </div>
        </section>
      ))}

      <div className="card flat help-more">
        <div>
          <div style={{ fontWeight: 700 }}>Не нашли ответ</div>
          <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
            Напишите в поддержку — ответим в кабинете. Полные условия — в{' '}
            <Link href="/rules" className="inline-link">
              правилах
            </Link>
            .
          </p>
        </div>
        <Link href="/cabinet/support" className="btn secondary">
          Написать в поддержку
        </Link>
      </div>
    </div>
  );
}
