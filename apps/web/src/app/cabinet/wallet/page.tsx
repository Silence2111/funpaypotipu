'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice } from '@/lib/format';
import { loadPublicPricing } from '@/lib/pricing';
import { refreshSummary } from '@/lib/summary';
import { CabinetNav } from '@/components/cabinet-nav';
import { TopUpForm } from '@/components/topup-form';
import { PayoutForm } from '@/components/payout-form';
import { PayoutRequests, type MyPayout } from '@/components/payout-requests';
import { StatementView } from '@/components/statement';
import { DealPayouts } from '@/components/deal-payouts';
import Link from 'next/link';
import { useT } from '@/lib/i18n/client';

interface Wallet {
  currency: string;
  balance: string;
  /** Оплаченные продажи до подтверждения покупателем — зачислятся потом. */
  inDeals: { count: number; amount: string };
  /** Заявки на вывод, которые ещё не выплачены. */
  withdrawing: { count: number; amount: string };
  /** Выплаты по «Безопасной сделке» в пути; waiting — ждут реквизиты (часть 123). */
  dealPayouts?: { count: number; amount: string; waiting: number };
  /** Удержано модератором (часть 134): не тратится и не выводится. */
  held?: { count: number; amount: string };
}

/**
 * Кошелёк: сколько доступно и сколько в пути, пополнение и вывод рядом,
 * заявки на вывод со статусами и выписка за любой период с фильтром по
 * типу операций и файлом для Excel.
 */
function WalletInner() {
  const t = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [payouts, setPayouts] = useState<MyPayout[]>([]);
  const [demo, setDemo] = useState(false);
  const [safeDeal, setSafeDeal] = useState(false);
  // Вернулись со страницы ЮKassa: баланс пополнится, когда придёт её подтверждение.
  const topupBack = params.get('topup') === '1';

  const reload = useCallback(() => {
    apiFetch<Wallet>('/wallet')
      .then(setWallet)
      .catch(() => {});
    apiFetch<MyPayout[]>('/payouts/mine')
      .then((rows) => setPayouts(rows ?? []))
      .catch(() => {});
    // Баланс в шапке — тот же.
    refreshSummary(true);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace(`/login?next=${encodeURIComponent('/cabinet/wallet')}`);
      return;
    }
    reload();
    void loadPublicPricing().then((p) => {
      setDemo(!!p?.paymentsDemo);
      setSafeDeal(p?.paymentScheme === 'safe_deal');
    });
  }, [router, reload]);

  useEffect(() => {
    if (!topupBack) return;
    const timer = setInterval(reload, 3000);
    const stop = setTimeout(() => clearInterval(timer), 60_000);
    return () => {
      clearInterval(timer);
      clearTimeout(stop);
    };
  }, [topupBack, reload]);

  const money = (v: string) => formatPrice(v, wallet?.currency ?? 'RUB', t);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>
          {t('Кошелёк')}
        </h1>
        <p className="muted" style={{ margin: '8px 0 0', maxWidth: '60ch' }}>
          {t(
            'Баланс, пополнение и вывод, все операции по деньгам. С баланса можно оплатить покупку или продвижение лота.',
          )}
        </p>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <section className="card wallet-hero" aria-label={t('Баланс')}>
        <div className="wallet-balance">
          <span className="stats-label">{t('Доступно')}</span>
          {wallet ? (
            <span className="wallet-amount">{money(wallet.balance)}</span>
          ) : (
            <span className="skeleton" style={{ height: 48, width: 200 }} aria-busy="true" />
          )}
        </div>
        {wallet && (wallet.inDeals.count > 0 || wallet.withdrawing.count > 0 || (wallet.held?.count ?? 0) > 0) && (
          <dl className="wallet-pending">
            {wallet.inDeals.count > 0 && (
              <div>
                <dt>{t('В сделках')}</dt>
                <dd>{money(wallet.inDeals.amount)}</dd>
                <span className="hint">
                  {t('{n} — зачислим, когда покупатели подтвердят получение, а с гарантией — когда она закончится', {
                    n: t.n(wallet.inDeals.count, 'продажа', 'продажи', 'продаж'),
                  })}
                </span>
              </div>
            )}
            {(wallet.held?.count ?? 0) > 0 && (
              <div>
                <dt>{t('Удержано')}</dt>
                <dd>{money(wallet.held!.amount)}</dd>
                <span className="hint">
                  {t('Модератор удержал спорную сумму, остальное можно выводить.')}{' '}
                  <Link href="/cabinet/decisions" style={{ color: 'var(--accent)' }}>{t('Причина и обжалование')}</Link>
                </span>
              </div>
            )}
            {wallet.withdrawing.count > 0 && (
              <div>
                <dt>{t('На выводе')}</dt>
                <dd>{money(wallet.withdrawing.amount)}</dd>
                <span className="hint">
                  {t('{n} — уже не на балансе', {
                    n: t.n(wallet.withdrawing.count, 'заявка', 'заявки', 'заявок'),
                  })}
                </span>
              </div>
            )}
          </dl>
        )}
      </section>

      {wallet && (safeDeal || (wallet.dealPayouts?.count ?? 0) > 0) && (
        <DealPayouts
          summary={wallet.dealPayouts ?? { count: 0, amount: '0', waiting: 0 }}
          currency={wallet.currency}
          onSaved={() => setTimeout(reload, 3000)}
        />
      )}

      {topupBack && (
        <div className="alert" role="status">
          {t(
            'Пополнение зачислится, как только банк подтвердит оплату, — обычно за несколько секунд.',
          )}
        </div>
      )}

      <div className="wallet-actions">
        <section className="card wallet-action">
          <h2 className="h2" style={{ fontSize: 20 }}>
            {t('Пополнение')}
          </h2>
          {safeDeal ? (
            // «Безопасная сделка»: деньги покупателей держит ЮKassa, баланс не пополняется.
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              {t('Пополнение баланса недоступно: заказы оплачиваются картой через «Безопасную сделку» ЮKassa.')}
            </p>
          ) : (
            <TopUpForm onDone={reload} />
          )}
          {demo && !safeDeal && (
            <p className="hint" style={{ marginTop: 6 }}>
              {t('На демо-стенде пополнение проходит без списания денег.')}
            </p>
          )}
        </section>
        <section className="card wallet-action">
          <h2 className="h2" style={{ fontSize: 20 }}>
            {t('Вывод средств')}
          </h2>
          <PayoutForm onDone={reload} />
        </section>
      </div>

      {payouts.length > 0 && (
        <section className="stack" style={{ gap: 12 }}>
          <h2 className="h2" style={{ fontSize: 20 }}>
            {t('Заявки на вывод')}
          </h2>
          <PayoutRequests items={payouts} />
        </section>
      )}

      <section className="card" style={{ padding: 24 }}>
        <h2 className="h2" style={{ fontSize: 20 }}>
          {t('Выписка по балансу')}
        </h2>
        <StatementView />
      </section>
    </div>
  );
}

export default function WalletPage() {
  return (
    <Suspense fallback={<div className="container" style={{ padding: 48 }} />}>
      <WalletInner />
    </Suspense>
  );
}
