import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getGame, browseListings } from '@/lib/api';
import { ListingCardView } from '@/components/cards';

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { slug } = await params;
  const { category } = await searchParams;

  const game = await getGame(slug);
  if (!game) notFound();

  const browse = await browseListings({
    gameSlug: slug,
    categorySlug: category,
    sort: 'new',
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
            href={`/igra/${slug}`}
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
                href={`/igra/${slug}?category=${c.slug}`}
                className="chip"
                style={active ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              >
                {c.title}
              </Link>
            );
          })}
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
              В этой категории пока нет лотов.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
