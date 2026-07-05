'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ImageIcon } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice } from '@/lib/format';

interface FavListing {
  id: string;
  title: string;
  price: string;
  currency: string;
  images: string[];
}

export default function FavoritesPage() {
  const router = useRouter();
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
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="h1" style={{ fontSize: 30 }}>Избранное</h1>
        <Link href="/cabinet" className="chip">← Кабинет</Link>
      </div>
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
              <div className="price" style={{ marginTop: 8 }}>{formatPrice(l.price, l.currency)}</div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="muted">В избранном пока пусто.</p>
      )}
    </div>
  );
}
