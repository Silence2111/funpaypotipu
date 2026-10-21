import Link from 'next/link';
import { ShieldCheck, Star } from 'lucide-react';
import { isDemoSeller } from '@gamemarket/shared';
import type { SellerProfile } from '@/lib/api';
import { presenceText, replyWhen, sinceText } from '@/lib/presence';
import { Avatar } from './offers';
import { LotChat } from './lot-chat';
import { getT } from '@/lib/i18n/server';
import { RU, type T } from '@/lib/i18n/lang';

/** «12 отзывов», «1 отзыв», «3 отзыва». */
export const reviewsCount = (n: number, t: T = RU): string => t.n(n, 'отзыв', 'отзыва', 'отзывов');

/**
 * Продавец на странице лота, как карточка продавца у FunPay: кто он, в сети
 * ли, рейтинг с числом отзывов, сколько продал, с какого времени на сайте и
 * за сколько обычно отвечает, и чат с ним прямо здесь. Раньше это была
 * строка с именем внизу панели покупки.
 */
export async function SellerCard({
  seller,
  lot,
}: {
  seller: SellerProfile;
  /** Лот, с которого пишут продавцу; `manual` — товар выдаёт продавец. */
  lot: { id: string; manual: boolean };
}) {
  const t = await getT();
  const seen = presenceText(seller.onlineAt, Date.now(), t);
  return (
    <section className="card seller-card" aria-label={t('Продавец')}>
      <div className="row" style={{ gap: 14, alignItems: 'center' }}>
        <Avatar name={seller.username} url={seller.avatarUrl} online={seller.online} size={52} t={t} />
        <div style={{ minWidth: 0 }}>
          <Link href={`/prodavec/${seller.id}`} className="seller-card-name">
            {seller.username}
          </Link>
          <div className="seller-card-seen" data-online={seller.online ? 'true' : undefined}>
            {seen ?? t('не в сети')}
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
        <span className="badge">{t.d(seller.level.label)}</span>
        {seller.away && <span className="badge warning">{t('в отпуске')}</span>}
        {seller.verified && (
          <span className="badge accent">
            <ShieldCheck size={13} strokeWidth={1.75} aria-hidden /> {t('Документы проверены')}
          </span>
        )}
        {isDemoSeller(seller.username) && <span className="demo-mark">{t('Пример')}</span>}
      </div>

      <dl className="seller-stats">
        <div>
          <dt>{t('Рейтинг')}</dt>
          <dd>
            {seller.ratingCount > 0 ? (
              <>
                <Star size={14} strokeWidth={1.75} className="star" aria-hidden /> {seller.ratingAvg.toFixed(1)}{' '}
                <span className="faint">· {reviewsCount(seller.ratingCount, t)}</span>
              </>
            ) : (
              <span className="faint">{t('отзывов пока нет')}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>{t('Продаж')}</dt>
          <dd>{t.num(seller.salesCount)}</dd>
        </div>
        <div>
          <dt>{t('На сайте')}</dt>
          <dd>{sinceText(seller.memberSince, t)}</dd>
        </div>
        {seller.replyTime && (
          <div>
            <dt>{t('Обычно отвечает')}</dt>
            <dd>{replyWhen(seller.replyTime, t)}</dd>
          </div>
        )}
      </dl>

      <LotChat listingId={lot.id} sellerId={seller.id} manual={lot.manual}>
        <Link href={`/prodavec/${seller.id}`} className="chip">
          {t('Все предложения')}
        </Link>
      </LotChat>
    </section>
  );
}
