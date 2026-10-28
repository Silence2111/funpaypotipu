'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { OPERATION_KINDS, mskDay, operationLabel, type OperationKind } from '@gamemarket/shared';
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
  /** Суммы операций выбранного типа (без типа — всех). */
  shown: { credits: string; debits: string };
  total: number;
  rows: Row[];
  more: boolean;
}

type PeriodKey = '30d' | 'month' | 'prev' | 'year' | 'custom';
const PERIODS: Array<{ key: PeriodKey; label: string }> = [
  { key: '30d', label: msg('30 дней') },
  { key: 'month', label: msg('Этот месяц') },
  { key: 'prev', label: msg('Прошлый месяц') },
  { key: 'year', label: msg('Этот год') },
  { key: 'custom', label: msg('Свой период') },
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Даты периода по Москве — как их считает сервер. */
function range(key: Exclude<PeriodKey, 'custom'>, now = new Date()): { from: string; to: string } {
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
 * списания, продажи за период, операции — новые сверху, по страницам.
 * Тип операций сужает список и файл; итоги — по всему балансу. Файлом для
 * Excel — выписка и продажи (самозанятому — доход для «Мой налог»).
 */
export function StatementView() {
  const t = useT();
  const [period, setPeriod] = useState<PeriodKey>('30d');
  // Свой период: пока даты неполные или начало позже конца — не запрашиваем.
  const [custom, setCustom] = useState(() => range('30d'));
  const [kind, setKind] = useState<OperationKind | ''>('');
  const [data, setData] = useState<Statement | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { from, to } = period === 'custom' ? custom : range(period);
  const invalid = period === 'custom' && (!DAY.test(from) || !DAY.test(to) || from > to);
  const periodQs = `from=${from}&to=${to}`;
  const qs = `${periodQs}${kind ? `&kind=${kind}` : ''}`;
  // «Показать ещё» дописывает только к той выписке, с которой начинал.
  const current = useRef(qs);

  useEffect(() => {
    current.current = qs;
    if (invalid) return;
    let stop = false;
    setData(null);
    setErr(null);
    apiFetch<Statement>(`/reports/statement?${qs}`)
      .then((s) => {
        if (stop) return;
        setData(s);
        setRows(s.rows);
      })
      .catch((e) => !stop && setErr(apiErrorMessage(e, t('Не удалось загрузить выписку.'))));
    return () => {
      stop = true;
    };
  }, [qs, invalid, t]);

  async function more() {
    const start = qs;
    setBusy('more');
    try {
      const s = await apiFetch<Statement>(`/reports/statement?${start}&offset=${rows.length}`);
      if (current.current !== start) return;
      setRows((prev) => [...prev, ...s.rows]);
      setData(s);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось загрузить выписку.')));
    } finally {
      setBusy(null);
    }
  }

  async function download(file: 'statement' | 'sales') {
    setBusy(file);
    setErr(null);
    try {
      await downloadFile(`/reports/${file}.csv?${file === 'statement' ? qs : periodQs}`);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Файл не скачался. Попробуйте ещё раз.')));
    } finally {
      setBusy(null);
    }
  }

  const money = (v: string) => formatPrice(v, data?.currency ?? 'RUB', t);
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' });
  const kindLabel = OPERATION_KINDS.find((k) => k.key === kind)?.label;

  /** Суммы выбранного типа: что пришло и что ушло — без нулевой половины. */
  function shownLine(s: Statement): string | null {
    if (!kindLabel) return null;
    const name = t.d(kindLabel);
    const plus = s.shown.credits !== '0';
    const minus = s.shown.debits !== '0';
    if (plus && minus)
      return t('{kind} за период: поступило {credits}, списано {debits}.', {
        kind: name,
        credits: money(s.shown.credits),
        debits: money(s.shown.debits),
      });
    if (plus)
      return t('{kind} за период: поступило {sum}.', { kind: name, sum: money(s.shown.credits) });
    if (minus)
      return t('{kind} за период: списано {sum}.', { kind: name, sum: money(s.shown.debits) });
    return null;
  }

  return (
    <div className="statement">
      <div className="row statement-controls">
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
        <select
          className="input statement-kind"
          aria-label={t('Тип операций')}
          value={kind}
          onChange={(e) => setKind(e.target.value as OperationKind | '')}
        >
          <option value="">{t('Все операции')}</option>
          {OPERATION_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {t.d(k.label)}
            </option>
          ))}
        </select>
      </div>

      {period === 'custom' && (
        <div className="row statement-dates">
          <label className="row">
            <span className="faint">{t('с')}</span>
            <input
              type="date"
              className="input"
              value={custom.from}
              max={custom.to || undefined}
              onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
              aria-label={t('Начало периода')}
            />
          </label>
          <label className="row">
            <span className="faint">{t('по')}</span>
            <input
              type="date"
              className="input"
              value={custom.to}
              min={custom.from || undefined}
              max={mskDay(new Date())}
              onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
              aria-label={t('Конец периода')}
            />
          </label>
        </div>
      )}

      {err && <p className="field-error">{err}</p>}

      {invalid ? (
        <p className="hint">{t('Укажите обе даты — начало не позже конца.')}</p>
      ) : !data ? (
        !err && <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
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
          {data.sales.count > 0 && !kind && (
            <p className="hint">
              {t('Продаж за период: {n} на {gross}, вам зачислено {payout}.', {
                n: data.sales.count,
                gross: money(data.sales.gross),
                payout: money(data.sales.payout),
              })}
            </p>
          )}
          {shownLine(data) && <p className="hint">{shownLine(data)}</p>}

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

          {rows.length === 0 ? (
            <p className="faint" style={{ fontSize: 13, margin: 0 }}>
              {kind ? t('Таких операций за период нет.') : t('За этот период операций нет.')}
            </p>
          ) : (
            <ul className="statement-rows">
              {rows.map((r) => {
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
          {data.more && (
            <button
              type="button"
              className="btn secondary"
              disabled={busy !== null}
              onClick={() => void more()}
              style={{ justifySelf: 'center' }}
            >
              {busy === 'more' ? '…' : t('Показать ещё')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
