import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
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

/** Крупная надпись обложки без количества — начало названия: «AWP Asiimov», «Перчатки Hydra» (у Playerok обложки разные). */
export function coverWords(title: string): string {
  const words = title.replace(/[^\p{L}\p{N}\s\-.]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (out.length && (out.join(' ') + ' ' + w).length > 18) break;
    out.push(w);
    if (out.length >= 2) break;
  }
  return out.join(' ');
}

/** Небольшой разброс наклона и размера предмета по лоту — чтобы соседние обложки не были копиями. */
function wobble(id: string): { rot: number; size: number } {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { rot: (h % 17) - 8, size: 42 + (h >> 5) % 9 };
}

/** Объёмный предмет на обложке по типу товара (свои рендеры Blender, `дизайн/3d`): как предметы на обложках Playerok. */
export function lotArt(segment?: string, categorySlug?: string): string {
  const bySlug: Record<string, string> = {
    stars: 'star', cards: 'card', topup: 'card', gifts: 'chest', keys: 'key', skins: 'chest', boost: 'bolt',
    'ps-plus': 'crown', premium: 'crown', nitro: 'crown', subscription: 'crown', subscriptions: 'crown', pass: 'crown',
  };
  const bySeg: Record<string, string> = { accounts: 'account', currency: 'coins', items: 'chest', key: 'key', topup: 'gem', service: 'wrench' };
  const k = (categorySlug && bySlug[categorySlug]) || (segment && bySeg[segment]) || 'gamepad';
  return `/3d/${k}.webp`;
}

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
            ) : null}
            {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер из public */}
            <img
              className="lc__obj"
              src={lotArt(l.category.segment, l.category.slug)}
              alt=""
              loading="lazy"
              style={{ ['--r' as string]: `${wobble(l.id).rot}deg`, width: `${wobble(l.id).size}%` }}
            />
            <span className="lc__big">
              {amount ? (
                <>
                  <b>{num}</b>
                  <span>{unit.join(' ')}</span>
                </>
              ) : (
                <span className="lc__sec">{coverWords(title) || t.d(l.category.title)}</span>
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

