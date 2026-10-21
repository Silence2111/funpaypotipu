'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Wallet, Package, Tag } from 'lucide-react';
import { apiFetch, getToken, getUser } from '@/lib/session';
import { logout } from '@/lib/logout';
import { formatListingPrice, formatPrice } from '@/lib/format';
import { TopUpForm } from '@/components/topup-form';
import { PayoutForm } from '@/components/payout-form';
import { StatementView } from '@/components/statement';
import { loadPublicPricing } from '@/lib/pricing';
import { BumpButton } from '@/components/bump-button';
import { SellerDashboard } from '@/components/seller-dashboard';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface WalletDto { currency: string; balance: string }
interface OrderRow { id: string; publicNumber: string; status: string; amount: string; currency: string }
interface ListingRow { id: string; title: string; price: string; currency: string; status: string; boostUntil?: string | null; topupMarkupBps?: number | null }

const STATUS: Record<string, string> = {
  created: msg('ждёт оплаты'), paid: msg('оплачен'), delivered: msg('выдан'), completed: msg('завершён'),
  disputed: msg('спор'), refunded: msg('возврат'), cancelled: msg('отменён'), expired: msg('истёк'),
};
const LISTING_STATUS: Record<string, string> = {
  active: msg('в продаже'), draft: msg('черновик'), paused: msg('снят'), sold_out: msg('распродан'), blocked: msg('заблокирован'),
};

export default function CabinetPage() {
  const router = useRouter();
  const t = useT();
  const [wallet, setWallet] = useState<WalletDto | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [listings, setListings] = useState<ListingRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Оплата демонстрационная — подсказка у пополнения; с ЮKassa её нет.
  const [demo, setDemo] = useState(false);
  // Вернулись со страницы ЮKassa: баланс пополнится, когда придёт её подтверждение.
  const [topupBack, setTopupBack] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login?next=/cabinet');
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

  useEffect(() => {
    void loadPublicPricing().then((p) => setDemo(!!p?.paymentsDemo));
    if (new URLSearchParams(window.location.search).get('topup') !== '1') return;
    setTopupBack(true);
    const timer = setInterval(() => void apiFetch<WalletDto>('/wallet').then(setWallet).catch(() => {}), 3000);
    const stop = setTimeout(() => clearInterval(timer), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, []);

  const user = getUser();
  if (loading)
    return (
      <div className="container" style={{ paddingTop: 48 }} aria-busy="true" aria-label={t('Загружаем кабинет')}>
        <div className="skeleton" style={{ height: 34, width: 200 }} />
        <div className="skeleton" style={{ height: 96, marginTop: 28 }} />
        <div className="skeleton" style={{ height: 160, marginTop: 20 }} />
      </div>
    );

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <p className="faint" style={{ margin: 0, fontSize: 14 }}>{user?.username}</p>
          <h1 className="h1" style={{ fontSize: 32 }}>{t('Кабинет')}</h1>
        </div>
        <Link href="/cabinet/new" className="btn">{t('Продать лот')}</Link>
      </div>
      <CabinetNav />

      <section>
        <div className="section-head">
          <h2 className="h2 row" style={{ fontSize: 20, gap: 8 }}><Package size={18} strokeWidth={1.75} /> {t('Мои заказы')}</h2>
        </div>
        {orders.length ? (
          <div className="grid" style={{ gap: 8 }}>
            {orders.slice(0, 5).map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="card link row"
                style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
                <span className="muted" style={{ fontSize: 14 }}>{o.publicNumber}</span>
                <span className="row" style={{ gap: 12 }}>
                  <span className="price">{formatPrice(o.amount, o.currency, t)}</span>
                  <span className={o.status === 'completed' ? 'badge success' : o.status === 'paid' || o.status === 'delivered' ? 'badge accent' : 'badge'}>
                    {STATUS[o.status] ? t(STATUS[o.status]!) : o.status}
                  </span>
                </span>
              </Link>
            ))}
            <Link href="/cabinet/orders" className="muted" style={{ fontSize: 14, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
              {t('Все покупки и продажи →')}
            </Link>
          </div>
        ) : (
          <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <span className="muted">{t('Заказов пока нет. Оплата хранится у площадки, пока вы не подтвердите получение.')}</span>
            <Link href="/catalog" className="btn secondary">{t('В каталог')}</Link>
          </div>
        )}
      </section>

      <section>
        <div className="section-head">
          <h2 className="h2 row" style={{ fontSize: 20, gap: 8 }}><Tag size={18} strokeWidth={1.75} /> {t('Мои лоты')}</h2>
        </div>
        {listings.length ? (
          <div className="grid" style={{ gap: 8 }}>
            {listings.slice(0, 5).map((l) => (
              <div key={l.id} className="card row"
                style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
                <Link href={`/cabinet/lot/${l.id}`} style={{ flex: 1, minWidth: 140, fontWeight: 600 }}>{l.title}</Link>
                <span className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                  <span className="price">{formatListingPrice(l, t)}</span>
                  <span className={l.status === 'active' ? 'badge success' : 'badge'}>
                    {LISTING_STATUS[l.status] ? t(LISTING_STATUS[l.status]!) : l.status}
                  </span>
                  {l.status === 'active' && <BumpButton listingId={l.id} boostUntil={l.boostUntil} />}
                </span>
              </div>
            ))}
            <Link href="/cabinet/lots" className="muted" style={{ fontSize: 14, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
              {listings.length > 5 ? t('Все лоты ({n}) →', { n: listings.length }) : t('Управлять лотами →')}
            </Link>
          </div>
        ) : (
          <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <span className="muted">{t('Лотов пока нет. Выставить первый — пара минут.')}</span>
            <Link href="/cabinet/new" className="btn secondary">{t('Создать лот')}</Link>
          </div>
        )}
      </section>

      <SellerDashboard />

      <section className="card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <Wallet size={22} strokeWidth={1.75} color="var(--accent)" />
          <div>
            <div className="faint" style={{ fontSize: 13 }}>{t('Баланс')}</div>
            <div className="price" style={{ fontSize: 26 }}>
              {wallet ? formatPrice(wallet.balance, wallet.currency, t) : '—'}
            </div>
          </div>
        </div>
        {topupBack && (
          <div className="alert" role="status" style={{ marginTop: 14 }}>
            {t('Пополнение зачислится, как только банк подтвердит оплату, — обычно за несколько секунд.')}
          </div>
        )}
        <TopUpForm onDone={() => apiFetch<WalletDto>('/wallet').then(setWallet).catch(() => {})} />
        {demo && (
          <p className="hint" style={{ marginTop: 6 }}>{t('На демо-стенде пополнение проходит без списания денег.')}</p>
        )}
        <hr className="divider" style={{ margin: '20px 0' }} />
        <div className="label">{t('Вывод средств')}</div>
        <PayoutForm onDone={() => apiFetch<WalletDto>('/wallet').then(setWallet).catch(() => {})} />
        <hr className="divider" style={{ margin: '20px 0' }} />
        <div className="label">{t('Выписка по балансу')}</div>
        <StatementView />
      </section>

      <button className="btn ghost" type="button" onClick={() => void logout().then(() => router.push('/'))}>
        {t('Выйти из аккаунта')}
      </button>
    </div>
  );
}
