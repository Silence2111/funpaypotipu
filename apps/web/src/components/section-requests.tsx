import type { BuyRequestPublic } from '@/lib/api';
import { formatPrice, mskDate } from '@/lib/format';
import { getT } from '@/lib/i18n/server';
import { OfferLot } from './buy-requests';
import { ReportButton } from './report-button';

/**
 * «Покупатели ищут» в разделе: открытые запросы «Хочу купить». Продавец
 * видит спрос раньше, чем выставит лот, и отвечает своим лотом.
 */
export async function SectionRequests({
  total,
  items,
  sellHref,
}: {
  total: number;
  items: BuyRequestPublic[];
  /** Форма нового лота в этом разделе. */
  sellHref: string;
}) {
  const t = await getT();
  if (!items.length) return null;
  return (
    <section style={{ marginTop: 32 }} aria-labelledby="requests-title">
      <div className="section-head">
        <h2 className="h2" id="requests-title" style={{ fontSize: 22 }}>
          {t('Покупатели ищут')} <span className="faint">{total}</span>
        </h2>
      </div>
      <p className="muted" style={{ margin: '0 0 12px', maxWidth: '64ch' }}>
        {t(
          'Запросы покупателей этого раздела. Есть подходящий лот — предложите: покупателю придёт ссылка на него.',
        )}
      </p>
      <ul className="requests">
        {items.map((r) => (
          <li key={r.id} id={`request-${r.id}`} className="card request-item">
            <div className="request-head">
              <span className="request-text">{r.text}</span>
              {r.maxPrice && (
                <span className="request-budget">
                  {t('до {price}', { price: formatPrice(r.maxPrice, 'RUB', t) })}
                </span>
              )}
            </div>
            <div className="request-meta">
              {r.buyer.username && <span>{r.buyer.username}</span>}
              <span>
                {t('{date}, открыт до {until}', {
                  date: mskDate(r.createdAt, t),
                  until: mskDate(r.expiresAt, t),
                })}
              </span>
              {r.offers > 0 && <span>{t('Предложено лотов: {n}', { n: r.offers })}</span>}
            </div>
            <div className="request-actions">
              <OfferLot requestId={r.id} buyerId={r.buyer.id} sellHref={sellHref} />
              <ReportButton targetType="buy_request" targetId={r.id} ownerId={r.buyer.id} inline />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
