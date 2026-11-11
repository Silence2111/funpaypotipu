'use client';

import { useEffect, useState } from 'react';
import { BUYER_AGE_DAYS, BUYER_FILTER_OFF, BUYER_LOST_DISPUTES, type BuyerFilter } from '@gamemarket/shared/buyer-filter';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';

/**
 * «Кому продавать» в «Инструментах» (часть 136): продавец отсекает
 * свежие аккаунты, покупателей с проигранными спорами и тех, кого другие
 * продавцы не рекомендуют. Условия видны покупателю на странице лота.
 */
export function BuyerFilterCard({ initial }: { initial: BuyerFilter | undefined }) {
  const t = useT();
  const [f, setF] = useState<BuyerFilter>(initial ?? BUYER_FILTER_OFF);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initial) setF(initial);
  }, [initial]);

  async function save(next: BuyerFilter) {
    setF(next);
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiFetch<{ buyerFilter: BuyerFilter }>('/seller-tools/buyer-filter', { method: 'PUT', body: JSON.stringify(next) });
      setF(r.buyerFilter);
      setMsg({ ok: true, text: t('Сохранено.') });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, t('Не удалось сохранить.')) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card tools-card" aria-labelledby="buyer-filter-title">
      <h2 className="h2 tools-title" id="buyer-filter-title">{t('Кому продавать')}</h2>
      <p className="muted tools-text">
        {t('Отсейте рискованных покупателей. Условия покупатель увидит на странице лота до заказа.')}
      </p>
      <div className="field">
        <label className="label" htmlFor="bf-age">{t('Аккаунт покупателя не моложе')}</label>
        <select id="bf-age" className="input" disabled={busy} value={f.minAgeDays}
          onChange={(e) => void save({ ...f, minAgeDays: Number(e.target.value) })}>
          {BUYER_AGE_DAYS.map((d) => (
            <option key={d} value={d}>{d === 0 ? t('Любой') : t.n(d, 'день', 'дня', 'дней')}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="label" htmlFor="bf-lost">{t('Проигранных споров за 90 дней — не больше')}</label>
        <select id="bf-lost" className="input" disabled={busy} value={f.maxLostDisputes ?? ''}
          onChange={(e) => void save({ ...f, maxLostDisputes: e.target.value === '' ? null : Number(e.target.value) })}>
          <option value="">{t('Не важно')}</option>
          {BUYER_LOST_DISPUTES.map((d) => (
            <option key={d} value={d}>{d === 0 ? t('Ни одного') : String(d)}</option>
          ))}
        </select>
      </div>
      <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={f.noBadReviews} disabled={busy} onChange={(e) => void save({ ...f, noBadReviews: e.target.checked })} />
        <span>{t('Не продавать тем, кого другие продавцы чаще не рекомендуют')}</span>
      </label>
      {msg && <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 8 }}>{msg.text}</div>}
    </section>
  );
}
