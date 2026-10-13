'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty, when } from './shared';

interface Payout { id: string; amount: string; currency: string; method: string; status: string; createdAt?: string }
interface Kyc { id: string; userId: string; level: string; status: string; createdAt?: string }

const METHOD: Record<string, string> = { card: 'на карту', sbp: 'по СБП', crypto: 'в USDT' };

/** Заявки на вывод: одобрить или отклонить — деньги двигает API с ролью «финансы». */
export function PayoutsSection() {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(await apiFetch<Payout[]>('/payouts?status=requested').catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    setErr(null);
    try {
      await apiFetch(`/payouts/${id}/${action}`, { method: 'POST', body: JSON.stringify({}) });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось обработать заявку.'));
    }
  }

  if (rows === null) return <div className="skeleton" style={{ height: 80 }} aria-busy="true" />;
  return (
    <section className="grid" style={{ gap: 8 }}>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows.length === 0 ? (
        <Empty>Заявок на вывод нет.</Empty>
      ) : (
        rows.map((p) => (
          <div key={p.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
            <span>
              <span className="price" style={{ fontSize: 16 }}>{formatPrice(p.amount, p.currency)}</span>{' '}
              <span className="faint" style={{ fontSize: 13 }}>{METHOD[p.method] ?? p.method}{p.createdAt ? ` · ${when(p.createdAt)}` : ''}</span>
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={() => void act(p.id, 'approve')} type="button">Одобрить</button>
              <button className="chip" onClick={() => void act(p.id, 'reject')} type="button">Отклонить</button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}

/** Заявки на верификацию продавцов. */
export function KycSection() {
  const [rows, setRows] = useState<Kyc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(await apiFetch<Kyc[]>('/kyc/pending').catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: 'approve' | 'reject') {
    setErr(null);
    try {
      await apiFetch(`/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ decision }) });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить решение.'));
    }
  }

  if (rows === null) return <div className="skeleton" style={{ height: 80 }} aria-busy="true" />;
  return (
    <section className="grid" style={{ gap: 8 }}>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows.length === 0 ? (
        <Empty>Заявок на верификацию нет.</Empty>
      ) : (
        rows.map((k) => (
          <div key={k.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 14 }}>
              Пользователь {k.userId.slice(0, 8)} · уровень {k.level}{k.createdAt ? ` · ${when(k.createdAt)}` : ''}
            </span>
            <span className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={() => void review(k.id, 'approve')} type="button">Одобрить</button>
              <button className="chip" onClick={() => void review(k.id, 'reject')} type="button">Отклонить</button>
            </span>
          </div>
        ))
      )}
    </section>
  );
}
