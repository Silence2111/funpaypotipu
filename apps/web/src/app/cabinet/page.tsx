'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wallet, Package, Tag } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';

interface WalletDto { currency: string; balance: string }
interface OrderRow { id: string; publicNumber: string; status: string; amount: string; currency: string }
interface ListingRow { id: string; title: string; price: string; currency: string; status: string }

const STATUS_RU: Record<string, string> = {
  created: 'создан', paid: 'оплачен', delivered: 'выдан', completed: 'завершён',
  disputed: 'спор', refunded: 'возврат', cancelled: 'отменён', expired: 'истёк',
};

export default function CabinetPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    Promise.all([
      apiFetch<WalletDto>('/wallet').catch(() => null),
      apiFetch<OrderRow[]>('/orders/mine').catch(() => []),
      apiFetch<ListingRow[]>('/listings/mine').catch(() => []),
    ]).then(([w, o, l]) => {
      setWallet(w);
      setOrders(o ?? []);
      setListings(l ?? []);
      setLoading(false);
    });
  }, [router]);

  const user = getUser();
  if (loading) return <div className="container" style={{ padding: 48 }} />;

  return (
    <div className="container stack-lg" style={{ paddingTop: 48 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 30 }}>Кабинет</h1>
        <p className="muted">{user?.username}</p>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Wallet size={22} strokeWidth={1.5} />
        <div>
          <div className="faint" style={{ fontSize: 13 }}>Баланс</div>
          <div className="price" style={{ fontSize: 24 }}>
            {wallet ? formatPrice(wallet.balance, wallet.currency) : '—'}
          </div>
        </div>
      </div>

      <section>
        <div className="section-head">
          <h2 className="h2" style={{ fontSize: 20 }}><Package size={18} /> Мои заказы</h2>
        </div>
        {orders.length ? (
          <div className="grid" style={{ gap: 8 }}>
            {orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="card link row"
                style={{ justifyContent: 'space-between', padding: 16 }}>
                <span>#{o.publicNumber}</span>
                <span className="row" style={{ gap: 12 }}>
                  <span className="price">{formatPrice(o.amount, o.currency)}</span>
                  <span className="badge">{STATUS_RU[o.status] ?? o.status}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="muted">Заказов пока нет.</p>}
      </section>

      <section>
        <div className="section-head">
          <h2 className="h2" style={{ fontSize: 20 }}><Tag size={18} /> Мои лоты</h2>
        </div>
        {listings.length ? (
          <div className="grid" style={{ gap: 8 }}>
            {listings.map((l) => (
              <Link key={l.id} href={`/lot/${l.id}`} className="card link row"
                style={{ justifyContent: 'space-between', padding: 16 }}>
                <span>{l.title}</span>
                <span className="row" style={{ gap: 12 }}>
                  <span className="price">{formatPrice(l.price, l.currency)}</span>
                  <span className="badge">{l.status}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : <p className="muted">Лотов пока нет.</p>}
      </section>
    </div>
  );
}
