import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ShieldCheck, Star } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import { getSeller, browseListings, getCategoryAttributes, type ListingCard } from '@/lib/api';
import { presenceText, sinceText } from '@/lib/presence';
import { offersCount } from '@/lib/format';
import { Avatar, OfferTable } from '@/components/offers';
import { SellerReviews } from '@/components/seller-reviews';
import { reviewsCount } from '@/components/seller-card';
import { ReportButton } from '@/components/report-button';
import { BlockButton } from '@/components/block-button';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const s = await getSeller(id);
  if (!s) return { title: 'Продавец не найден' };
  return {
    title: `${s.displayName} — продавец на GameMarket`,
    description: `${s.ratingCount > 0 ? `Рейтинг ${s.ratingAvg.toFixed(1)}, ${reviewsCount(s.ratingCount)}. ` : ''}Продаж: ${s.salesCount}. ${offersCount(s.activeListings)}.`,
  };
}

/** Предложения продавца по разделам: «Counter-Strike 2 · Аккаунты» и таблица под ним. */
function groupBySection(items: ListingCard[]) {
  const groups = new Map<string, { key: string; game: ListingCard['game']; section: ListingCard['category']; items: ListingCard[] }>();
  for (const l of items) {
    const key = `${l.game.slug}/${l.category.slug}`;
    const g = groups.get(key) ?? { key, game: l.game, section: l.category, items: [] };
    g.items.push(l);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => a.game.title.localeCompare(b.game.title, 'ru') || a.section.title.localeCompare(b.section.title, 'ru'),
  );
}

/**
 * Профиль продавца, как у FunPay: кто он и в сети ли, рейтинг с разбивкой по
 * оценкам, предложения по разделам таблицами и отзывы с фильтром. Раньше
 * лоты шли плитками вперемешку, без игр и разделов.
 */
export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await getSeller(id);
  if (!seller) notFound();

  const browse = await browseListings({ sellerId: id, limit: 60 });
  const items = browse?.items ?? [];
  const total = browse?.total ?? items.length;
  const groups = groupBySection(items);
  const attrs = await Promise.all(
    groups.map((g) => (g.section.id ? getCategoryAttributes(g.section.id) : Promise.resolve(null))),
  );
  const seen = presenceText(seller.onlineAt);

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <section className="card profile-head">
        <div className="profile-id">
          <Avatar name={seller.username} url={seller.avatarUrl} online={seller.online} size={88} />
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <h1 className="h1 profile-name">{seller.displayName}</h1>
              <span className="badge">{seller.level.label}</span>
              {seller.away && <span className="badge warning">в отпуске</span>}
              {seller.verified && (
                <span className="badge accent">
                  <ShieldCheck size={13} strokeWidth={1.75} aria-hidden /> Документы проверены
                </span>
              )}
              {isDemoSeller(seller.username) && <span className="demo-mark">Пример</span>}
            </div>
            <p className="faint" style={{ margin: '6px 0 0', fontSize: 14 }}>
              @{seller.username} ·{' '}
              <span style={{ color: seller.online ? 'var(--success)' : undefined }}>{seen ?? 'не в сети'}</span>
            </p>
            {seller.bio && (
              <p className="muted" style={{ margin: '12px 0 0', fontSize: 15, maxWidth: '60ch' }}>
                {seller.bio}
              </p>
            )}
            <dl className="profile-stats">
              <div>
                <dt>Рейтинг</dt>
                <dd>
                  {seller.ratingCount > 0 ? (
                    <>
                      <Star size={16} strokeWidth={1.75} className="star" aria-hidden /> {seller.ratingAvg.toFixed(1)}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
              <div>
                <dt>Отзывы</dt>
                <dd>{new Intl.NumberFormat('ru-RU').format(seller.ratingCount)}</dd>
              </div>
              <div>
                <dt>Продаж</dt>
                <dd>{new Intl.NumberFormat('ru-RU').format(seller.salesCount)}</dd>
              </div>
              <div>
                <dt>На сайте</dt>
                <dd>{sinceText(seller.memberSince)}</dd>
              </div>
            </dl>
            <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <BlockButton userId={seller.id} username={seller.username} />
              <ReportButton targetType="user" targetId={seller.id} ownerId={seller.id} />
            </div>
          </div>
        </div>

        {seller.ratingCount > 0 && (
          <div className="profile-breakdown" aria-label="Оценки покупателей">
            {seller.ratingBreakdown.map(({ star, count }) => {
              const pct = Math.round((count / seller.ratingCount) * 100);
              return (
                <div key={star} className="bar-row">
                  <span className="faint">{star} ★</span>
                  <span className="bar">
                    <span style={{ width: `${pct}%` }} />
                  </span>
                  <span className="faint num">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section style={{ marginTop: 40 }} aria-labelledby="offers-title">
        <h2 className="h2" id="offers-title" style={{ marginBottom: 4 }}>
          Предложения
        </h2>
        <p className="faint" style={{ margin: '0 0 20px', fontSize: 14 }}>
          {total > 0
            ? offersCount(total)
            : seller.away
              ? 'Продавец в отпуске — предложения вернутся вместе с ним.'
              : 'Сейчас у продавца нет активных предложений.'}
          {total > items.length ? ` · показаны первые ${items.length}` : ''}
        </p>
        {groups.map((g, i) => (
          <div key={g.key} className="profile-group">
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <Link href={`/igra/${g.game.slug}/${g.section.slug}`} className="profile-group-title">
                {g.game.title} · {g.section.title}
              </Link>
              <span className="faint" style={{ fontSize: 14 }}>
                {g.items.length}
              </span>
            </div>
            <OfferTable items={g.items} attributes={attrs[i] ?? []} hideSeller />
          </div>
        ))}
      </section>

      <section id="reviews" style={{ marginTop: 40, scrollMarginTop: 80 }} aria-labelledby="reviews-title">
        <h2 className="h2" id="reviews-title" style={{ marginBottom: 16 }}>
          Отзывы
        </h2>
        <SellerReviews sellerId={seller.id} breakdown={seller.ratingBreakdown} />
      </section>
    </div>
  );
}
