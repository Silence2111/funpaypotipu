'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, getToken } from '@/lib/session';
import { formatPrice } from '@/lib/format';

interface Payout { id: string; amount: string; currency: string; method: string; status: string }
interface Kyc { id: string; userId: string; level: string; status: string }

export default function AdminPage() {
  const router = useRouter();
  const [payouts, setPayouts] = useState<Payout[] | null>(null);
  const [kyc, setKyc] = useState<Kyc[] | null>(null);
  const [promoMsg, setPromoMsg] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [value, setValue] = useState('');

  const load = useCallback(async () => {
    setPayouts(await apiFetch<Payout[]>('/payouts?status=requested').catch(() => null));
    setKyc(await apiFetch<Kyc[]>('/kyc/pending').catch(() => null));
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/login');
      return;
    }
    load();
  }, [router, load]);

  const noAccess = payouts === null && kyc === null;

  async function payoutAction(id: string, action: 'approve' | 'reject') {
    await apiFetch(`/payouts/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
    load();
  }
  async function kycReview(id: string, decision: 'approve' | 'reject') {
    await apiFetch(`/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) }).catch(() => {});
    load();
  }
  async function createPromo(e: React.FormEvent) {
    e.preventDefault();
    setPromoMsg(null);
    try {
      await apiFetch('/promo', {
        method: 'POST',
        body: JSON.stringify({ code, type: 'fixed', value: Math.round(parseFloat(value || '0') * 100) }),
      });
      setPromoMsg(`Промокод ${code.toUpperCase()} создан`);
      setCode('');
      setValue('');
    } catch {
      setPromoMsg('Не удалось создать (нужна роль admin)');
    }
  }

  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 720 }}>
      <h1 className="h1" style={{ fontSize: 30 }}>Панель управления</h1>
      {noAccess && <p className="muted">Нет доступа к разделам управления.</p>}

      {payouts && (
        <section>
          <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Заявки на вывод</h2>
          {payouts.length ? payouts.map((p) => (
            <div key={p.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, marginBottom: 8 }}>
              <span>{formatPrice(p.amount, p.currency)} · {p.method}</span>
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" style={{ padding: '7px 16px' }} onClick={() => payoutAction(p.id, 'approve')} type="button">Одобрить</button>
                <button className="chip" onClick={() => payoutAction(p.id, 'reject')} type="button">Отклонить</button>
              </span>
            </div>
          )) : <p className="muted">Заявок нет.</p>}
        </section>
      )}

      {kyc && (
        <section>
          <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Верификация (KYC)</h2>
          {kyc.length ? kyc.map((k) => (
            <div key={k.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, marginBottom: 8 }}>
              <span className="faint" style={{ fontSize: 13 }}>{k.userId.slice(0, 8)} · уровень {k.level}</span>
              <span className="row" style={{ gap: 8 }}>
                <button className="btn" style={{ padding: '7px 16px' }} onClick={() => kycReview(k.id, 'approve')} type="button">Одобрить</button>
                <button className="chip" onClick={() => kycReview(k.id, 'reject')} type="button">Отклонить</button>
              </span>
            </div>
          )) : <p className="muted">Заявок нет.</p>}
        </section>
      )}

      <section>
        <h2 className="h2" style={{ fontSize: 20, marginBottom: 16 }}>Создать промокод</h2>
        <form onSubmit={createPromo} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Код" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 180 }} />
          <input className="input" placeholder="Скидка, ₽" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 140 }} />
          <button className="btn" type="submit">Создать</button>
        </form>
        {promoMsg && <p className="muted" style={{ fontSize: 14, marginTop: 10 }}>{promoMsg}</p>}
      </section>
    </div>
  );
}
