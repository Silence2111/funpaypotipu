'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ImageIcon } from 'lucide-react';
import { PRICE_DROP_MIN_PCT } from '@gamemarket/shared/saved-search';
import { apiFetch, getToken } from '@/lib/session';
import { formatListingPrice, formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

interface FavListing {
  id: string;
  title: string;
  price: string;
  currency: string;
  images: string[];
  status?: string;
  topupMarkupBps?: number | null;
  unitName?: string | null;
  pricePerUnits?: number;
  /** Цена при добавлении в избранное, если сейчас дешевле. */
  wasPrice?: string | null;
}

export default function FavoritesPage() {
  const router = useRouter();
  const t = useT();
  const [items, setItems] = useState<FavListing[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    apiFetch<FavListing[]>('/favorites')
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div className="container" style={{ padding: 48 }} />;

  return (
    <div className="container" style={{ paddingTop: 48 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h1 className="h1" style={{ fontSize: 30 }}>{t('Избранное')}</h1>
        <Link href="/cabinet" className="chip">← {t('Кабинет')}</Link>
      </div>
      <p className="muted" style={{ margin: '0 0 24px', maxWidth: '60ch' }}>
        {t('Лот подешевеет хотя бы на {pct}% — придёт уведомление. Настройка — в группе «Поиски и избранное».', {
          pct: PRICE_DROP_MIN_PCT,
        })}
      </p>
      {items.length ? (
        <div className="grid cols-auto">
          {items.map((l) => (
            <Link key={l.id} href={`/lot/${l.id}`} className="card link" style={{ display: 'block' }}>
              <div className="thumb">
                {l.images?.[0] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.images[0]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' }} />
                ) : (
                  <ImageIcon size={22} strokeWidth={1.5} />
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{l.title}</div>
              <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                <span className="price">{formatListingPrice(l, t)}</span>
                {l.wasPrice && (
                  <span className="badge success">
                    {t('было {price}', { price: formatPrice(l.wasPrice, l.currency, t) })}
                  </span>
                )}
                {l.status === 'sold_out' && <span className="badge">{t('закончился')}</span>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">{t('В избранном пока пусто.')}</p>
      )}
    </div>
  );
}
