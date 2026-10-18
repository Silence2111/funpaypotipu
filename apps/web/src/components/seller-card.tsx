import Link from 'next/link';
import { ShieldCheck, Star } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import type { SellerProfile } from '@/lib/api';
import { presenceText, sinceText } from '@/lib/presence';
import { Avatar } from './offers';
import { LotChat } from './lot-chat';

/** «12 отзывов», «1 отзыв», «3 отзыва». */
export function reviewsCount(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'отзыв' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'отзыва' : 'отзывов';
  return `${new Intl.NumberFormat('ru-RU').format(n)} ${w}`;
}

/**
 * Продавец на странице лота, как карточка продавца у FunPay: кто он, в сети
 * ли, рейтинг с числом отзывов, сколько продал и с какого времени на сайте,
 * и чат с ним прямо здесь. Раньше это была строка с именем внизу панели
 * покупки.
 */
export function SellerCard({
  seller,
  lot,
}: {
  seller: SellerProfile;
  /** Лот, с которого пишут продавцу; `manual` — товар выдаёт продавец. */
  lot: { id: string; manual: boolean };
}) {
  const seen = presenceText(seller.onlineAt);
  return (
    <section className="card seller-card" aria-label="Продавец">
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <Avatar name={seller.username} url={seller.avatarUrl} online={seller.online} size={52} />
        <div style={{ minWidth: 0 }}>
          <Link href={`/prodavec/${seller.id}`} className="seller-card-name">
            {seller.username}
          </Link>
          <div className="seller-card-seen" data-online={seller.online ? 'true' : undefined}>
            {seen ?? 'не в сети'}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        <span className="badge">{seller.level.label}</span>
        {seller.away && <span className="badge warning">в отпуске</span>}
        {seller.verified && (
          <span className="badge accent">
            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden /> Документы проверены
          </span>
        )}
        {isDemoSeller(seller.username) && <span className="demo-mark">Пример</span>}
      </div>

      <dl className="seller-stats">
        <div>
          <dt>Рейтинг</dt>
          <dd>
            {seller.ratingCount > 0 ? (
              <>
                <Star size={14} strokeWidth={1.75} className="star" aria-hidden /> {seller.ratingAvg.toFixed(1)}{' '}
                <span className="faint">· {reviewsCount(seller.ratingCount)}</span>
              </>
            ) : (
              <span className="faint">отзывов пока нет</span>
            )}
          </dd>
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

      <LotChat listingId={lot.id} sellerId={seller.id} manual={lot.manual}>
        <Link href={`/prodavec/${seller.id}`} className="chip">
          Все предложения
        </Link>
      </LotChat>
    </section>
  );
}
