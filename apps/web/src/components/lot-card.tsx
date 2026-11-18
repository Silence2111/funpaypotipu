import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import { lotTitle } from '@/lib/lot-text';
import type { ListingCard } from '@/lib/api';
import { gameIcon } from '@/lib/game-icons';
import { formatListingPrice } from '@/lib/format';
import { RU, type T } from '@/lib/i18n/lang';
import { GameIcon } from './game-icon';
import { SaleMark } from './sale-mark';

/**
 * Карточка лота плиткой, как в выдаче Playerok и GGSel: сверху игра и раздел, обложка
 * (фото продавца, а без фото — знак игры на её цвете), цена, название, продавец.
 * Рейтинг — только из настоящих отзывов; демо-лоты помечены «Пример».
 */
export function LotCard({ l, t = RU }: { l: ListingCard; t?: T }) {
  const instant = l.fulfillmentType === 'auto_key' || l.fulfillmentType === 'provider';
  const demo = isDemoSeller(l.seller.profile?.username);
  const seller = l.seller.profile;
  const reviews = seller?.ratingCount ?? 0;
  const tint = gameIcon(l.game.slug)?.bg;
  return (
    <Link href={`/lot/${l.id}`} className="lc">
      <span className="lc__game">
        <GameIcon slug={l.game.slug} title={l.game.title} size={30} />
        <span>
          <b>{t.d(l.game.title)}</b>
          <small>{t.d(l.category.title)}</small>
        </span>
      </span>
      <span className="lc__cover" style={tint ? { ['--lc-tint' as string]: tint } : undefined}>
        {l.images?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="lc__photo" src={l.images[0]} alt="" loading="lazy" />
        ) : (
          <GameIcon slug={l.game.slug} title={l.game.title} size={76} />
        )}
        <span className="lc__badges">
          {instant && (
            <span className="lc__badge lc__badge--fast">
              <Zap size={12} strokeWidth={2.2} aria-hidden /> {t('Автовыдача')}
            </span>
          )}
          {demo && (
            <span className="lc__badge" title={t('Демонстрационный лот: показывает, как устроена сделка')}>
              {t('Пример')}
            </span>
          )}
        </span>
      </span>
      <span className="lc__price">
        {formatListingPrice(l, t)}
        <SaleMark listPrice={l.saleRefPrice ?? l.saleListPrice} price={l.price} currency={l.currency} t={t} />
      </span>
      <span className="lc__title">{lotTitle(l, t.lang)}</span>
      <span className="lc__seller">
        {reviews > 0 ? (
          <>
            <Star size={13} strokeWidth={1.75} className="star" aria-hidden /> {seller!.ratingAvg.toFixed(1)}
            <span className="faint"> · {t.n(reviews, 'отз.', 'отз.', 'отз.')}</span>
          </>
        ) : (
          <span className="faint">{t('нет отзывов')}</span>
        )}
        {seller && <span className="lc__name">{seller.username}</span>}
      </span>
    </Link>
  );
}
