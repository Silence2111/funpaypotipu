import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import type { Game, ListingCard } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { tileFor } from '@/lib/tile';

export function ListingCardView({ listing }: { listing: ListingCard }) {
  const cover = listing.images?.[0];
  const onAt = listing.seller.profile?.onlineAt;
  const online = onAt ? Date.now() - new Date(onAt).getTime() < 5 * 60 * 1000 : false;
  const instant = listing.fulfillmentType === 'auto_key' || listing.fulfillmentType === 'provider';
  return (
    <Link href={`/lot/${listing.id}`} className="card link" style={{ display: 'block' }}>
      <div className="thumb">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
          />
        ) : (
          <GameTile title={listing.game?.title || listing.title} size={20} />
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.35 }}>{listing.title}</div>
      {instant && (
        <div className="row" style={{ gap: 4, marginTop: 6, fontSize: 12, color: '#1a7f37' }}>
          <Zap size={12} strokeWidth={2} /> мгновенная выдача
        </div>
      )}
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
        <span className="price">{formatPrice(listing.price, listing.currency)}</span>
        {listing.seller.profile && (
          <span className="row faint" style={{ fontSize: 13, gap: 4 }}>
            {online && (
              <span title="продавец онлайн" style={{ width: 7, height: 7, borderRadius: 999, background: '#34c759' }} />
            )}
            <Star size={13} strokeWidth={1.75} />
            {listing.seller.profile.ratingAvg.toFixed(1)}
          </span>
        )}
      </div>
    </Link>
  );
}

export function GameCardView({ game }: { game: Game }) {
  return (
    <Link href={`/igra/${game.slug}`} className="card link" style={{ display: 'block' }}>
      <div className="thumb" style={{ aspectRatio: '1 / 1' }}>
        {game.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={game.iconUrl}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }}
          />
        ) : (
          <GameTile title={game.title} size={26} />
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 500 }}>{game.title}</div>
    </Link>
  );
}

/**
 * Заглушка обложки: цветная плитка с буквами названия.
 *
 * Серый прямоугольник с иконкой «нет изображения» на каждой карточке читается
 * как сломанная страница, а чужие обложки игр брать нельзя. Цвет выводится
 * из названия, поэтому у одной игры он всегда одинаковый.
 */
function GameTile({ title, size }: { title: string; size: number }) {
  const t = tileFor(title);
  return (
    <div
      aria-hidden
      style={{
        width: '100%',
        height: '100%',
        borderRadius: 'inherit',
        background: t.background,
        color: t.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size,
        fontWeight: 700,
        letterSpacing: '-0.02em',
      }}
    >
      {t.initials}
    </div>
  );
}
