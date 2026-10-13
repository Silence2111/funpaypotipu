import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGame, browseListings } from '@/lib/api';
import { ListingCardView } from '@/components/cards';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = await getGame(slug);
  if (!game) return { title: 'Игра не найдена' };
  return {
    title: `${game.title} — купить аккаунты, ключи, предметы`,
    description: `Безопасная покупка товаров ${game.title} с эскроу-защитой: аккаунты, валюта, предметы, ключи.`,
    alternates: { canonical: `/igra/${slug}` },
  };
}

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string; online?: string }>;
}) {
  const { slug } = await params;
  const { category, online } = await searchParams;
  const onlineOnly = online === '1';
  const href = (patch: { category?: string; online?: boolean }) => {
    const p = new URLSearchParams();
    const c = 'category' in patch ? patch.category : category;
    const o = 'online' in patch ? patch.online : onlineOnly;
    if (c) p.set('category', c);
    if (o) p.set('online', '1');
    const s = p.toString();
    return `/igra/${slug}${s ? `?${s}` : ''}`;
  };

  const game = await getGame(slug);
  if (!game) notFound();

  const browse = await browseListings({
    gameSlug: slug,
    categorySlug: category,
    sort: 'new',
    online: onlineOnly,
    limit: 24,
  });
  const listings = browse?.items ?? [];

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      <div>
        <Link href="/" className="faint" style={{ fontSize: 14 }}>
          ← Каталог
        </Link>
        <h1 className="h1" style={{ fontSize: 34, marginTop: 12 }}>
          {game.title}
        </h1>
      </div>

      {game.categories.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          <Link
            href={href({ category: undefined })}
            className="chip"
            style={!category ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
          >
            Все
          </Link>
          {game.categories.map((c) => {
            const active = c.slug === category;
            return (
              <Link
                key={c.id}
                href={href({ category: c.slug })}
                className="chip"
                style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                {c.title}
              </Link>
            );
          })}
          <span className="spacer" />
          <Link href={href({ online: !onlineOnly })} className="chip" aria-pressed={onlineOnly}
            style={onlineOnly ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}>
            <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--success)' }} />
            Продавец онлайн
          </Link>
        </div>
      )}

      <section>
        {listings.length > 0 ? (
          <div className="grid cols-auto">
            {listings.map((l) => (
              <ListingCardView key={l.id} listing={l} />
            ))}
          </div>
        ) : (
          <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <p className="muted" style={{ margin: 0 }}>
              {onlineOnly ? 'Сейчас никто из продавцов этого раздела не онлайн.' : 'В этой категории пока нет лотов.'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
