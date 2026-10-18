import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPublicPricing } from '@/lib/api';
import { HELP_ARTICLES, helpArticle, termsFrom } from '@/lib/help';
import { JsonLd, breadcrumbLd } from '@/components/json-ld';

type Params = Promise<{ slug: string }>;

// Статья собирается при каждом открытии: при сборке сайта API недоступен,
// и в статьи попали бы запасные цифры вместо действующих условий.
export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const a = helpArticle((await params).slug);
  if (!a) return { title: 'Статья не найдена' };
  return { title: `${a.title} — помощь`, description: a.summary, alternates: { canonical: `/pomosch/${a.slug}` } };
}

/** Статья «Помощи»: цифры — из условий площадки на сегодня, а не из текста. */
export default async function HelpArticlePage({ params }: { params: Params }) {
  const a = helpArticle((await params).slug);
  if (!a) notFound();
  const terms = termsFrom(await getPublicPricing());
  const more = HELP_ARTICLES.filter((x) => x.slug !== a.slug);

  return (
    <div className="container help-layout" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <JsonLd
        data={breadcrumbLd([
          ['Помощь', '/pomosch'],
          [a.title, `/pomosch/${a.slug}`],
        ])}
      />
      <article className="help-article">
        <nav className="crumbs" aria-label="Путь">
          <Link href="/pomosch">Помощь</Link>
          <span aria-hidden>/</span>
          <span>{a.group}</span>
        </nav>
        <h1 className="h1 help-title">{a.title}</h1>
        <p className="lead help-lead">{a.summary}</p>
        <div className="help-body">{a.body(terms)}</div>
        <div className="card flat help-more">
          <div>
            <div style={{ fontWeight: 700 }}>Остались вопросы</div>
            <p className="muted" style={{ margin: '2px 0 0', fontSize: 14 }}>
              Поддержка отвечает в кабинете, а по сделке — пишите в чате заказа.
            </p>
          </div>
          <Link href="/cabinet/support" className="btn secondary">
            Написать в поддержку
          </Link>
        </div>
      </article>

      <aside className="help-aside" aria-label="Другие статьи">
        <div className="help-aside-title">Другие статьи</div>
        <nav>
          {more.map((x) => (
            <Link key={x.slug} href={`/pomosch/${x.slug}`}>
              {x.title}
            </Link>
          ))}
        </nav>
      </aside>
    </div>
  );
}
