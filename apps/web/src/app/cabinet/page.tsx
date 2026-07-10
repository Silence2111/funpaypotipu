'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wallet, Package, Tag } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { TopUpForm } from '@/components/topup-form';
import { PayoutForm } from '@/components/payout-form';
import { WalletTransactions } from '@/components/wallet-transactions';
import { BumpButton } from '@/components/bump-button';
import { SellerDashboard } from '@/components/seller-dashboard';

interface WalletDto { currency: string; balance: string }
interface OrderRow { id: string; publicNumber: string; status: string; amount: string; currency: string }
interface ListingRow { id: string; title: string; price: string; currency: string; status: string; boostUntil?: string | null }

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
        <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <Link href="/cabinet/new" className="chip">+ Создать лот</Link>
          <Link href="/cabinet/chats" className="chip">Диалоги</Link>
          <Link href="/cabinet/favorites" className="chip">Избранное</Link>
          <Link href="/cabinet/security" className="chip">Безопасность</Link>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Wallet size={22} strokeWidth={1.5} />
          <div>
            <div className="faint" style={{ fontSize: 13 }}>Баланс</div>
            <div className="price" style={{ fontSize: 24 }}>
              {wallet ? formatPrice(wallet.balance, wallet.currency) : '—'}
            </div>
          </div>
        </div>
        <TopUpForm onDone={() => apiFetch<WalletDto>('/wallet').then(setWallet).catch(() => {})} />
        <hr className="divider" style={{ margin: '16px 0' }} />
        <div className="faint" style={{ fontSize: 13 }}>Вывод средств</div>
        <PayoutForm onDone={() => apiFetch<WalletDto>('/wallet').then(setWallet).catch(() => {})} />
        <hr className="divider" style={{ margin: '16px 0' }} />
        <div className="faint" style={{ fontSize: 13 }}>История операций</div>
        <WalletTransactions />
      </div>

      <SellerDashboard />

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
          <Link href="/cabinet/new" className="chip">+ Создать лот</Link>
        </div>
        {listings.length ? (
          <div className="grid" style={{ gap: 8 }}>
            {listings.map((l) => (
              <div key={l.id} className="card row"
                style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
                <Link href={`/lot/${l.id}`} style={{ flex: 1, minWidth: 140 }}>{l.title}</Link>
                <span className="row" style={{ gap: 12 }}>
                  <span className="price">{formatPrice(l.price, l.currency)}</span>
                  {l.status === 'active' && <BumpButton listingId={l.id} boostUntil={l.boostUntil} />}
                  <span className="badge">{l.status}</span>
                </span>
              </div>
            ))}
          </div>
        ) : <p className="muted">Лотов пока нет.</p>}
      </section>
    </div>
  );
}
