import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicPricing } from '@/lib/api';
import { HELP_ARTICLES, HELP_GROUPS, helpArticle, helpBody, termsFrom } from '@/lib/help';
import { JsonLd, breadcrumbLd } from '@/components/json-ld';
import { getT } from '@/lib/i18n/server';

type Params = Promise<{ slug: string }>;

// Статья собирается при каждом открытии: при сборке сайта API недоступен,
// и в статьи попали бы запасные цифры вместо действующих условий.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const t = await getT();
  const a = helpArticle((await params).slug);
  if (!a) return { title: t('Статья не найдена') };
  return {
    title: t('{title} — помощь', { title: t(a.title) }),
    description: t(a.summary),
    alternates: { canonical: `/pomosch/${a.slug}` },
  };
}

/** Статья «Помощи»: цифры — из условий площадки на сегодня, а не из текста. */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const t = await getT();
  const a = helpArticle((await params).slug);
  if (!a) notFound();
  const group = HELP_GROUPS.find((g) => g.key === a.group);
  const terms = termsFrom(await getPublicPricing());
  const more = HELP_ARTICLES.filter((x) => x.slug !== a.slug);

  return (
    <div className="container help-layout" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <JsonLd
        data={breadcrumbLd([
          [t('Помощь'), '/pomosch'],
          [t(a.title), `/pomosch/${a.slug}`],
        ])}
      />
      <article className="help-article">
        <nav className="crumbs" aria-label={t('Путь')}>
          <Link href="/pomosch">{t('Помощь')}</Link>
          <span aria-hidden>/</span>
          <span>{group ? t(group.label) : null}</span>
        </nav>
        <h1 className="h1 help-title">{t(a.title)}</h1>
        <p className="lead help-lead">{t(a.summary)}</p>
        <div className="help-body">{helpBody(a.slug, terms, t)}</div>
        <div className="card flat help-more">
          <div>
            <div style={{ fontWeight: 700 }}>{t('Остались вопросы')}</div>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
              {t('Поддержка отвечает в кабинете, а по сделке — пишите в чате заказа.')}
            </p>
          </div>
          <Link href="/cabinet/support" className="btn secondary">
            {t('Написать в поддержку')}
          </Link>
        </div>
      </article>

      <aside className="help-aside" aria-label={t('Другие статьи')}>
        <div className="help-aside-title">{t('Другие статьи')}</div>
        <nav>
          {more.map((x) => (
            <Link key={x.slug} href={`/pomosch/${x.slug}`}>
              {t(x.title)}
            </Link>
          ))}
        </nav>
      </aside>
    </div>
  );
}
