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
import { getT } from '@/lib/i18n/server';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [s, t] = await Promise.all([getSeller(id), getT()]);
  if (!s) return { title: t('Продавец не найден') };
  const rating =
    s.ratingCount > 0
      ? `${t('Рейтинг {r}, {reviews}.', { r: s.ratingAvg.toFixed(1), reviews: reviewsCount(s.ratingCount, t) })} `
      : '';
  return {
    title: t('{name} — продавец на GameMarket', { name: s.displayName }),
    description: `${rating}${t('Продаж: {n}', { n: t.num(s.salesCount) })}. ${offersCount(s.activeListings, t)}.`,
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
  const [seller, t] = await Promise.all([getSeller(id), getT()]);
  if (!seller) notFound();

  const browse = await browseListings({ sellerId: id, limit: 60 });
  const items = browse?.items ?? [];
  const total = browse?.total ?? items.length;
  const groups = groupBySection(items);
  const attrs = await Promise.all(
    groups.map((g) => (g.section.id ? getCategoryAttributes(g.section.id) : Promise.resolve(null))),
  );
  const seen = presenceText(seller.onlineAt, Date.now(), t);

  return (
    <div className="container" style={{ paddingTop: 40, paddingBottom: 24 }}>
      <section className="card profile-head">
        <div className="profile-id">
          <Avatar name={seller.username} url={seller.avatarUrl} online={seller.online} size={88} />
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <h1 className="h1 profile-name">{seller.displayName}</h1>
              <span className="badge">{t.d(seller.level.label)}</span>
              {seller.away && <span className="badge warning">{t('в отпуске')}</span>}
              {seller.verified && (
                <span className="badge accent">
                  <ShieldCheck size={13} strokeWidth={1.75} aria-hidden /> {t('Документы проверены')}
                </span>
              )}
              {isDemoSeller(seller.username) && <span className="demo-mark">{t('Пример')}</span>}
            </div>
            <p className="faint" style={{ margin: '6px 0 0', fontSize: 14 }}>
              @{seller.username} ·{' '}
              <span style={{ color: seller.online ? 'var(--success)' : undefined }}>{seen ?? t('не в сети')}</span>
            </p>
            {seller.bio && (
              <p className="muted" style={{ margin: '12px 0 0', fontSize: 15, maxWidth: '60ch' }}>
                {seller.bio}
              </p>
            )}
            <dl className="profile-stats">
              <div>
                <dt>{t('Рейтинг')}</dt>
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
                <dt>{t('Отзывы')}</dt>
                <dd>{t.num(seller.ratingCount)}</dd>
              </div>
              <div>
                <dt>{t('Продаж')}</dt>
                <dd>{t.num(seller.salesCount)}</dd>
              </div>
              <div>
                <dt>{t('На сайте')}</dt>
                <dd>{sinceText(seller.memberSince, t)}</dd>
              </div>
            </dl>
            <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <BlockButton userId={seller.id} username={seller.username} />
              <ReportButton targetType="user" targetId={seller.id} ownerId={seller.id} />
            </div>
          </div>
        </div>

        {seller.ratingCount > 0 && (
          <div className="profile-breakdown" aria-label={t('Оценки покупателей')}>
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
          {t('Предложения')}
        </h2>
        <p className="faint" style={{ margin: '0 0 20px', fontSize: 14 }}>
          {total > 0
            ? offersCount(total, t)
            : seller.away
              ? t('Продавец в отпуске — предложения вернутся вместе с ним.')
              : t('Сейчас у продавца нет активных предложений.')}
          {total > items.length ? ` · ${t('показаны первые {n}', { n: items.length })}` : ''}
        </p>
        {groups.map((g, i) => (
          <div key={g.key} className="profile-group">
            <div className="row" style={{ gap: 8, marginBottom: 10 }}>
              <Link href={`/igra/${g.game.slug}/${g.section.slug}`} className="profile-group-title">
                {t.d(g.game.title)} · {t.d(g.section.title)}
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
          {t('Отзывы')}
        </h2>
        <SellerReviews sellerId={seller.id} breakdown={seller.ratingBreakdown} />
      </section>
    </div>
  );
}
