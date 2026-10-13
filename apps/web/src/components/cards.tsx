import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import type { Game, ListingCard } from '@/lib/api';
import { formatListingPrice, formatPrice, formatQty, perPackLabel } from '@/lib/format';
import { tileFor } from '@/lib/tile';
import { ApproxPrice } from './approx-price';

export function ListingCardView({ listing }: { listing: ListingCard }) {
  const cover = listing.images?.[0];
  const onAt = listing.seller.profile?.onlineAt;
  const online = onAt ? Date.now() - new Date(onAt).getTime() < 5 * 60 * 1000 : false;
  const instant = listing.fulfillmentType === 'auto_key' || listing.fulfillmentType === 'provider';
  const pack = perPackLabel(listing);
  // Оплаченное продвижение помечается: покупатель должен видеть, почему лот выше.
  const promoted = !!listing.promotedUntil && new Date(listing.promotedUntil).getTime() > Date.now();
  // Наличие показываем у того, что продаётся количеством: валюта и ключи.
  const stock =
    listing.stock != null && (listing.unitName || listing.fulfillmentType === 'auto_key')
      ? formatQty(listing.stock, listing.unitName)
      : null;
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
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{listing.title}</div>
      <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        {instant && (
          <span className="badge success">
            <Zap size={12} strokeWidth={2} /> выдача сразу
          </span>
        )}
        {isDemoSeller(listing.seller.profile?.username) && (
          <span className="demo-mark" title="Демонстрационный лот: показывает, как устроена сделка">Пример</span>
        )}
        {stock && <span className="faint" style={{ fontSize: 13 }}>в наличии {stock}</span>}
        {promoted && <span className="faint" style={{ fontSize: 12 }}>продвижение</span>}
      </div>
      <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, gap: 8 }}>
        {pack ? (
          <span>
            <span className="price">{formatPrice(listing.price, listing.currency)}</span>{' '}
            <span className="faint" style={{ fontSize: 13 }}>{pack}</span>
          </span>
        ) : (
          <span>
            <span className="price">{formatListingPrice(listing)}</span>{' '}
            <ApproxPrice minor={listing.price} currency={listing.currency} />
          </span>
        )}
        {listing.seller.profile && (
          <span className="row faint" style={{ fontSize: 13, gap: 4 }}>
            {online && (
              <span title="продавец онлайн" style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--success)' }} />
            )}
            {/* Рейтинг показываем только если он из настоящих отзывов */}
            {listing.seller.profile.ratingAvg > 0 ? (
              <>
                <Star size={13} strokeWidth={1.75} />
                {listing.seller.profile.ratingAvg.toFixed(1)}
              </>
            ) : null}
          </span>
        )}
      </div>
    </Link>
  );
}

export function GameCardView({ game }: { game: Game }) {
  // Компактная строка вместо квадрата на всю ширину колонки: восемь больших
  // цветных квадратов перетягивали внимание с лотов и цен.
  return (
    <Link href={`/igra/${game.slug}`} className="card link row" style={{ gap: 12, padding: 12 }}>
      <div style={{ width: 44, height: 44, borderRadius: 10, flex: 'none', overflow: 'hidden' }}>
        {game.iconUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.iconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <GameTile title={game.title} size={15} />
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.3 }}>{game.title}</div>
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
        fontWeight: 800,
        letterSpacing: '-0.02em',
      }}
    >
      {t.initials}
    </div>
  );
}
