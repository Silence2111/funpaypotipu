import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShieldCheck, Star, Package, Calendar } from 'lucide-react';
import { getSeller, browseListings } from '@/lib/api';
import { ListingCardView } from '@/components/cards';
import { SellerReviews } from '@/components/seller-reviews';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const s = await getSeller(id);
  if (!s) return { title: 'Продавец не найден' };
  return {
    title: `${s.displayName} — продавец на GameMarket`,
    description: `Рейтинг ${s.ratingAvg.toFixed(1)}, продаж: ${s.salesCount}. ${s.activeListings} активных лотов.`,
  };
}

function presence(online: boolean, onlineAt: string | null): string | null {
  if (online) return 'в сети';
  if (!onlineAt) return null;
  const mins = Math.floor((Date.now() - new Date(onlineAt).getTime()) / 60000);
  if (mins < 1) return 'был только что';
  if (mins < 60) return `был ${mins} мин назад`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `был ${h} ч назад`;
  const d = Math.floor(h / 24);
  return `был ${d} дн назад`;
}

export default async function SellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const seller = await getSeller(id);
  if (!seller) notFound();

  const browse = await browseListings({ sellerId: id, limit: 48 });
  const items = browse?.items ?? [];
  const seen = presence(seller.online, seller.onlineAt);
  const initial = (seller.displayName || seller.username || '?').charAt(0).toUpperCase();

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      {/* Шапка витрины */}
      <div className="card" style={{ padding: 24 }}>
        <div className="row" style={{ gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
            background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 30, fontWeight: 600, color: 'var(--fg-muted)',
            overflow: 'hidden',
          }}>
            {seller.avatarUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={seller.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : initial}
          </div>

          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              <h1 className="h1" style={{ fontSize: 26 }}>{seller.displayName}</h1>
              {seller.verified && (
                <span className="row" style={{ gap: 4, fontSize: 13, color: '#0071e3' }}>
                  <ShieldCheck size={16} strokeWidth={2} /> Проверенный
                </span>
              )}
              <span className="badge">{seller.level.label}</span>
            </div>
            <p className="faint" style={{ margin: '4px 0 0', fontSize: 14 }}>
              @{seller.username}
              {seen && (
                <>
                  {' · '}
                  <span style={{ color: seller.online ? '#1a7f37' : 'var(--fg-faint)' }}>{seen}</span>
                </>
              )}
            </p>
            {seller.bio && <p className="muted" style={{ margin: '12px 0 0', fontSize: 14 }}>{seller.bio}</p>}

            <div className="row" style={{ gap: 20, marginTop: 16, flexWrap: 'wrap' }}>
              <span className="row" style={{ gap: 6, fontSize: 14 }}>
                <Star size={15} strokeWidth={1.75} fill="#f5a623" color="#f5a623" />
                {seller.ratingCount > 0 ? `${seller.ratingAvg.toFixed(1)} · ${seller.ratingCount} отз.` : 'нет оценок'}
              </span>
              <span className="row faint" style={{ gap: 6, fontSize: 14 }}>
                <Package size={15} strokeWidth={1.75} /> продаж: {seller.salesCount}
              </span>
              <span className="row faint" style={{ gap: 6, fontSize: 14 }}>
                <Calendar size={15} strokeWidth={1.75} />
                с {new Date(seller.memberSince).toLocaleDateString('ru-RU', { year: 'numeric', month: 'long' })}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Лоты продавца */}
      <section>
        <div className="section-head">
          <h2 className="h2" style={{ fontSize: 20 }}>Активные лоты · {items.length}</h2>
        </div>
        {items.length ? (
          <div className="grid cols-auto">
            {items.map((l) => <ListingCardView key={l.id} listing={l} />)}
          </div>
        ) : (
          <p className="muted">У продавца нет активных лотов.</p>
        )}
      </section>

      {/* Отзывы */}
      <section>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Отзывы</h2>
        <SellerReviews sellerId={seller.id} />
      </section>
    </div>
  );
}
