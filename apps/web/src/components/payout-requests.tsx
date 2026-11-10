'use client';

import { useState } from 'react';
import { computeWithdrawalFee, getWithdrawalMethod } from '@gamemarket/shared';
import { formatPrice, mskDate } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';
import { noteText } from '@/lib/hidden';

export interface MyPayout {
  id: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  createdAt: string;
  holdUntil: string | null;
  /** Куда: «•••• 4477» — без полного номера. */
  destinationHint?: string | null;
  /** Шлюз не выплатил — деньги вернулись на баланс. */
  failureReason?: string | null;
  /** Почему отклонил сотрудник. */
  rejectReason?: string | null;
}

/** Статус заявки для продавца: «отправляется» — шлюз ещё не подтвердил. */
const STATUS: Record<string, string> = {
  requested: msg('на проверке'),
  approved: msg('отправляется'),
  processing: msg('отправляется'),
  paid: msg('выплачено'),
  rejected: msg('отклонена, деньги на балансе'),
};

/** Сколько заявок видно сразу; остальные — по «Показать все». */
const FIRST = 5;

/**
 * Заявки на вывод: сумма и «на руки» после комиссии способа, куда и когда,
 * статус. Отклонённая — с подсказкой, что делать; первая заявка до первой
 * продажи — с датой, раньше которой её не отправят.
 */
export function PayoutRequests({ items }: { items: MyPayout[] }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  const now = Date.now();
  // По Москве — как выписка рядом: заявка и её операция в выписке одного дня.
  const date = (iso: string) => mskDate(iso, t);

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="card notif-list">
        {shown.map((p) => {
          const method = getWithdrawalMethod(p.method);
          const net = method
            ? (BigInt(p.amount) - computeWithdrawalFee(BigInt(p.amount), method)).toString()
            : null;
          const held = p.status === 'requested' && p.holdUntil && Date.parse(p.holdUntil) > now;
          return (
            <div key={p.id} className="payout-row">
              <span className="payout-main">
                <span className="payout-amount">{formatPrice(p.amount, p.currency, t)}</span>
                <span className="payout-sub">
                  {method ? t.d(method.label) : p.method}
                  {p.destinationHint ? ` · ${p.destinationHint}` : ''} · {date(p.createdAt)}
                  {net && net !== p.amount && p.status !== 'rejected' && (
                    <> · {t('на руки {sum}', { sum: formatPrice(net, p.currency, t) })}</>
                  )}
                </span>
                {held && (
                  <span className="payout-note">
                    {t('Первый вывод до первой продажи отправим не раньше {date}.', {
                      date: date(p.holdUntil!),
                    })}
                  </span>
                )}
                {p.status === 'rejected' && p.rejectReason && (
                  <span className="payout-reason">
                    {t('Причина: {reason}', { reason: noteText(t, p.rejectReason) })}
                  </span>
                )}
                {p.status === 'rejected' && !p.rejectReason && p.failureReason && (
                  <span className="payout-note">
                    {t(
                      'Платёжная система не провела выплату — проверьте реквизиты или выберите другой способ.',
                    )}
                  </span>
                )}
              </span>
              <span className={p.status === 'paid' ? 'badge success' : 'badge'}>
                {STATUS[p.status] ? t(STATUS[p.status]!) : p.status}
              </span>
            </div>
          );
        })}
      </div>
      {items.length > FIRST && (
        <button
          type="button"
          className="btn ghost"
          onClick={() => setAll(!all)}
          style={{ alignSelf: 'center' }}
        >
          {all ? t('Свернуть') : t('Показать все ({n})', { n: items.length })}
        </button>
      )}
    </div>
  );
}
