import Link from 'next/link';
import { Coins, Gem, KeyRound, LayoutGrid, Star, Sword, UserRound, Wrench, Zap } from 'lucide-react';
import type { ComponentType } from 'react';
import { isDemoSeller } from '@gamemarket/shared';
import { lotTitle } from '@/lib/lot-text';
import type { ListingCard } from '@/lib/api';
import { coverColor, coverIsLight, gameIcon } from '@/lib/game-icons';
import { formatListingPrice } from '@/lib/format';
import { RU, type T } from '@/lib/i18n/lang';
import { GameIcon } from './game-icon';
import { SaleMark } from './sale-mark';

/** Количество из названия для обложки, как на обложках Playerok и GGSel: «1800 UC», «1000 TL», «12 месяцев». */
export function coverAmount(title: string): string | null {
  const m = title.match(
    // i18n-ignore — единицы из названий лотов, не текст интерфейса
    /(\d[\d\s]{0,8}\d|\d)\s*(UC|TL|USD|\$|₽|руб\S*|алмаз\S*|зв[её]зд\S*|robux|робукс\S*|месяц\S*|мес\b|гем\S*|кристалл\S*|золот\S*|V-?bucks|months?|diamonds?|stars|gems|crystals|gold)/iu, // i18n-ignore
  );
  return m ? `${m[1].replace(/\s+/g, ' ').trim()} ${m[2].replace(/[,.]$/, '')}` : null;
}

/** Значок типа товара — крупно на обложке игры без своего знака (вместо огромных букв «ES», «G5»). */
const SEG_ART: Record<string, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  accounts: UserRound, currency: Coins, items: Sword, key: KeyRound, topup: Gem, service: Wrench,
};

/**
 * Карточка лота по образцу выдачи Playerok (18.11.2026): сверху игра и раздел, яркая обложка
 * (фото продавца, а без фото — цвет марки, крупно количество или раздел и большой знак игры у края),
 * цена со скидкой красной плашкой, название в две строки, звёзды продавца. Рейтинг — только
 * из настоящих отзывов; демо-лоты помечены «Пример».
 */
export function LotCard({ l, t = RU }: { l: ListingCard; t?: T }) {
  const instant = l.fulfillmentType === 'auto_key' || l.fulfillmentType === 'provider';
  const demo = isDemoSeller(l.seller.profile?.username);
  const seller = l.seller.profile;
  const reviews = seller?.ratingCount ?? 0;
  const icon = gameIcon(l.game.slug);
  const title = lotTitle(l, t.lang);
  const amount = coverAmount(title);
  // «1800 UC» → число крупно, единица строкой ниже; без количества — раздел («Аккаунты», «Скины»)
  const [num, ...unit] = (amount ?? '').split(' ');
  const light = coverIsLight(l.game.slug);
  return (
    <Link href={`/lot/${l.id}`} className="lc">
      <span className="lc__game">
        <GameIcon slug={l.game.slug} title={l.game.title} size={28} />
        <span>
          <b>{t.d(l.game.title)}</b>
          <small>{t.d(l.category.title)}</small>
        </span>
      </span>
      <span
        className={light ? 'lc__cover lc__cover--light' : 'lc__cover'}
        style={{ ['--c' as string]: coverColor(l.game.slug, l.game.title) }}
      >
        {l.images?.[0] ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="lc__photo" src={l.images[0]} alt="" loading="lazy" />
        ) : (
          <>
            {icon ? (
              <span className="lc__mark" style={{ WebkitMaskImage: `url(${icon.src})`, maskImage: `url(${icon.src})` }} aria-hidden />
            ) : (
              <SegArt segment={l.category.segment} />
            )}
            <span className="lc__big">
              {amount ? (
                <>
                  <b>{num}</b>
                  <span>{unit.join(' ')}</span>
                </>
              ) : (
                <span className="lc__sec">{t.d(l.category.title)}</span>
              )}
            </span>
          </>
        )}
        <span className="lc__badges">
          {instant && (
            <span className="lc__badge lc__badge--fast">
              <Zap size={12} strokeWidth={2.4} aria-hidden /> {t('Автовыдача')}
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
      <span className="lc__title">{title}</span>
      <span className="lc__seller">
        {reviews > 0 ? (
          <>
            <span className="lc__stars" aria-label={t('Рейтинг {r} из 5', { r: seller!.ratingAvg.toFixed(1) })}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={12} strokeWidth={0} className={i < Math.round(seller!.ratingAvg) ? 'on' : ''} aria-hidden />
              ))}
            </span>
            <span className="faint">{reviews}</span>
          </>
        ) : (
          <span className="faint">{t('нет отзывов')}</span>
        )}
        {seller && <span className="lc__name">{seller.username}</span>}
      </span>
    </Link>
  );
}

function SegArt({ segment }: { segment?: string }) {
  const Ico = (segment && SEG_ART[segment]) || LayoutGrid;
  return (
    <span className="lc__seg" aria-hidden>
      <Ico size={120} strokeWidth={1.6} />
    </span>
  );
}
