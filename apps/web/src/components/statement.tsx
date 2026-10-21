'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { mskDay, operationLabel } from '@gamemarket/shared';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { downloadFile } from '@/lib/download';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Row {
  id: string;
  createdAt: string;
  refType: string | null;
  orderId: string | null;
  orderNumber: string | null;
  amount: string;
  balance: string;
}
interface Statement {
  from: string;
  to: string;
  currency: string;
  opening: string;
  credits: string;
  debits: string;
  closing: string;
  sales: { count: number; gross: string; payout: string };
  total: number;
  rows: Row[];
}

type PeriodKey = '30d' | 'month' | 'prev' | 'year';
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: '30d', label: msg('30 дней') },
  { key: 'month', label: msg('Этот месяц') },
  { key: 'prev', label: msg('Прошлый месяц') },
  { key: 'year', label: msg('Этот год') },
];

/** Даты периода по Москве — как их считает сервер. */
function range(key: PeriodKey, now = new Date()): { from: string; to: string } {
  const today = mskDay(now);
  const [y, m] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const pad = (n: number) => String(n).padStart(2, '0');
  if (key === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  if (key === 'year') return { from: `${y}-01-01`, to: today };
  if (key === 'prev') {
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
    return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(last)}` };
  }
  return { from: mskDay(new Date(now.getTime() - 29 * 86400_000)), to: today };
}

/**
 * Выписка по балансу за период: остаток на начало и конец, поступления и
 * списания, продажи за период, операции. Файлом для Excel — выписка и
 * продажи (самозанятому — доход для «Мой налог»).
 */
export function StatementView() {
  const t = useT();
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [data, setData] = useState<Statement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { from, to } = range(period);
  const qs = `from=${from}&to=${to}`;

  useEffect(() => {
    setData(null);
    apiFetch<Statement>(`/reports/statement?${qs}`)
      .then(setData)
      .catch((e) => setErr(apiErrorMessage(e, t('Не удалось загрузить выписку.'))));
  }, [qs, t]);

  async function download(kind: 'statement' | 'sales') {
    setBusy(kind);
    setErr(null);
    try {
      await downloadFile(`/reports/${kind}.csv?${qs}`);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Файл не скачался. Попробуйте ещё раз.')));
    } finally {
      setBusy(null);
    }
  }

  const money = (v: string) => formatPrice(v, data?.currency ?? 'RUB', t);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' });

  return (
    <div className="statement">
      <div className="row statement-periods" role="group" aria-label={t('Период выписки')}>
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            className="chip"
            aria-pressed={period === p.key}
            onClick={() => setPeriod(p.key)}
          >
            {t(p.label)}
          </button>
        ))}
      </div>

      {err && <p className="field-error">{err}</p>}

      {!data ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : (
        <>
          <dl className="statement-totals">
            <div>
              <dt>{t('На начало')}</dt>
              <dd>{money(data.opening)}</dd>
            </div>
            <div>
              <dt>{t('Поступило')}</dt>
              <dd>+{money(data.credits)}</dd>
            </div>
            <div>
              <dt>{t('Списано')}</dt>
              <dd>−{money(data.debits)}</dd>
            </div>
            <div>
              <dt>{t('На конец')}</dt>
              <dd>{money(data.closing)}</dd>
            </div>
          </dl>
          {data.sales.count > 0 && (
            <p className="hint">
              {t('Продаж за период: {n} на {gross}, вам зачислено {payout}.', {
                n: data.sales.count,
                gross: money(data.sales.gross),
                payout: money(data.sales.payout),
              })}
            </p>
          )}

          <div className="row statement-files">
            <button
              type="button"
              className="chip"
              disabled={busy !== null}
              onClick={() => void download('statement')}
            >
              <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Выписка для Excel')}
            </button>
            <button
              type="button"
              className="chip"
              disabled={busy !== null}
              onClick={() => void download('sales')}
            >
              <Download size={16} strokeWidth={1.75} aria-hidden /> {t('Продажи для Excel')}
            </button>
          </div>

          {data.rows.length === 0 ? (
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>
              {t('За этот период операций нет.')}
            </p>
          ) : (
            <ul className="statement-rows">
              {data.rows.map((r) => {
                const plus = !r.amount.startsWith('-');
                return (
                  <li key={r.id}>
                    <span className="statement-op">
                      {t.d(operationLabel(r.refType))}
                      <span className="faint">
                        {day(r.createdAt)}
                        {r.orderId && r.orderNumber && (
                          <>
                            {' · '}
                            <Link href={`/orders/${r.orderId}`} className="statement-order">
                              {r.orderNumber}
                            </Link>
                          </>
                        )}
                      </span>
                    </span>
                    <span className={plus ? 'statement-sum plus' : 'statement-sum'}>
                      {plus ? '+' : '−'}
                      {money(plus ? r.amount : r.amount.slice(1))}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {data.total > data.rows.length && (
            <p className="hint">
              {t('Показаны последние {n} операций из {total} — все в файле.', {
                n: data.rows.length,
                total: data.total,
              })}
            </p>
          )}
        </>
      )}
    </div>
  );
}
