'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty, when } from './shared';

interface Run {
  id: string;
  trigger: string;
  windowFrom: string;
  windowTo: string;
  status: 'running' | 'ok' | 'issues' | 'skipped' | 'error';
  checked: { payments: number; refunds: number; payouts: number; dealPayouts: number } | null;
  newIssues: number;
  error: string | null;
  startedAt: string;
  startedBy: string | null;
}
type Side = {
  id?: string;
  status?: string;
  amount?: string | null;
  currency?: string;
  paymentId?: string;
  refunded?: string | null;
} | null;
interface Issue {
  id: string;
  kind: string;
  text: string;
  entity: 'payment' | 'refund' | 'payout' | 'deal_payout';
  ref: string;
  externalId: string | null;
  ours: Side;
  theirs: Side;
  createdAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  note: string | null;
}
interface Overview {
  reconciliation: { autoEveryHours: number; runs: Run[]; open: number; issues: Issue[] };
  watch: {
    state: {
      errors5m: number;
      topError: string | null;
      failedInRow: number;
      webhookFailures15m: number;
      stuckPayouts: number;
      stuckDealPayouts: number;
    };
    thresholds: {
      errorSpike: number;
      failedPayments: number;
      webhookFailures: number;
      payoutStuckHours: number;
    };
    telegram: boolean;
  };
  alerts: Array<{ id: string; key: string; text: string; sent: boolean; createdAt: string }>;
}
interface ErrorGroup {
  id: string;
  source: 'api' | 'web';
  message: string;
  context: string | null;
  stack: string | null;
  path: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

const RUN_STATUS: Record<Run['status'], { label: string; tone: string }> = {
  running: { label: 'идёт', tone: 'badge' },
  ok: { label: 'сходится', tone: 'badge success' },
  issues: { label: 'есть расхождения', tone: 'badge danger' },
  skipped: { label: 'нечего сверять', tone: 'badge' },
  error: { label: 'не прошла', tone: 'badge warning' },
};
const ENTITY: Record<Issue['entity'], string> = {
  payment: 'оплата',
  refund: 'возврат',
  payout: 'выплата',
  deal_payout: 'выплата по сделке',
};
const STATUS: Record<string, string> = {
  succeeded: 'прошла',
  pending: 'ждёт',
  canceled: 'отменена',
  failed: 'не прошла',
  refunded: 'возвращена',
  paid: 'выплачено',
  processing: 'отправляется',
  sent: 'отправлено',
  rejected: 'отклонено',
  waiting_for_capture: 'ждёт подтверждения',
};
const rub = (v: string | null | undefined) =>
  v === null || v === undefined ? '—' : formatPrice(v, 'RUB');

/** Одна сторона расхождения: статус и сумма — у нас или у ЮKassa. */
function SideLine({ label, side }: { label: string; side: Side }) {
  if (!side) return <span className="faint">{label}: нет записи</span>;
  const amount = side.amount ?? side.refunded;
  return (
    <span>
      {label}: {side.status ? (STATUS[side.status] ?? side.status) : 'запись есть'}
      {amount !== undefined && amount !== null ? ` · ${rub(amount)}` : ''}
    </span>
  );
}

function IssueCard({ issue, onResolved }: { issue: Issue; onResolved: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function resolve() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch(`/admin/ops/issues/${issue.id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      onResolved();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось закрыть.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="card" style={{ padding: 16, display: 'grid', gap: 6, fontSize: 14 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b>{issue.text}</b>
        <span className="badge">{ENTITY[issue.entity]}</span>
      </div>
      <div className="row faint" style={{ gap: '4px 16px', flexWrap: 'wrap' }}>
        <SideLine label="У нас" side={issue.ours} />
        <SideLine label="У ЮKassa" side={issue.theirs} />
      </div>
      <span className="faint" style={{ fontSize: 13 }}>
        {issue.externalId ? `№ у ЮKassa ${issue.externalId} · ` : ''}
        {issue.ours?.id ? `наш id ${issue.ours.id.slice(0, 8)} · ` : ''}
        найдено {when(issue.createdAt)}
        {issue.lastSeenAt !== issue.createdAt ? `, ещё есть на ${when(issue.lastSeenAt)}` : ''}
      </span>
      {issue.resolvedAt ? (
        <span className="muted">
          Закрыто {when(issue.resolvedAt)}
          {issue.resolvedBy ? ` · ${issue.resolvedBy}` : ''} — {issue.note}
        </span>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Что было и что сделали — в журнал"
            aria-label="Пометка к расхождению"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="btn secondary"
            disabled={busy || note.trim().length < 3}
            onClick={() => void resolve()}
          >
            {busy ? '…' : 'Закрыть с пометкой'}
          </button>
        </div>
      )}
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
    </div>
  );
}

/** Группы ошибок — только администратору: в тексте ошибки бывают данные людей. */
function ErrorsBlock() {
  const [resolved, setResolved] = useState(false);
  const [rows, setRows] = useState<ErrorGroup[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    setRows(null);
    apiFetch<ErrorGroup[]>(`/admin/ops/errors${resolved ? '?resolved=1' : ''}`)
      .then(setRows)
      .catch((e: unknown) => setErr(apiErrorMessage(e, 'Ошибки не загрузились.')));
  }, [resolved]);
  useEffect(load, [load]);
  async function done(id: string) {
    try {
      await apiFetch(`/admin/ops/errors/${id}/resolve`, { method: 'POST' });
      load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось отметить.'));
    }
  }
  return (
    <section className="stack-form" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <h3 className="h2" style={{ fontSize: 18, margin: 0 }}>
          Ошибки
        </h3>
        <button
          type="button"
          className="chip"
          aria-pressed={!resolved}
          onClick={() => setResolved(false)}
        >
          Открытые
        </button>
        <button
          type="button"
          className="chip"
          aria-pressed={resolved}
          onClick={() => setResolved(true)}
        >
          Решённые
        </button>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Ошибки API и страниц сайта, одинаковые — одной строкой со счётчиком. Решённая открывается
        снова, если ошибка повторилась.
      </p>
      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}
      {rows === null ? (
        <div className="skeleton" style={{ height: 100 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>{resolved ? 'Решённых нет.' : 'Ошибок нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((g) => (
            <div
              key={g.id}
              className="card"
              style={{ padding: 14, display: 'grid', gap: 6, fontSize: 14 }}
            >
              <div
                className="row"
                style={{ gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}
              >
                <b style={{ wordBreak: 'break-word' }}>{g.message.slice(0, 300)}</b>
                <span className="badge">×{g.count}</span>
              </div>
              <span className="faint" style={{ fontSize: 13 }}>
                {g.source === 'api' ? 'API' : 'сайт'}
                {g.path ? ` · ${g.path}` : ''}
                {g.context && g.context !== 'web' ? ` · ${g.context}` : ''} · последний раз{' '}
                {when(g.lastSeenAt)}, впервые {when(g.firstSeenAt)}
              </span>
              {g.stack && (
                <details>
                  <summary className="faint" style={{ fontSize: 13 }}>
                    Стек
                  </summary>
                  <pre
                    className="secret"
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      maxHeight: 240,
                      overflow: 'auto',
                    }}
                  >
                    {g.stack}
                  </pre>
                </details>
              )}
              {!g.resolvedAt && (
                <div>
                  <button type="button" className="chip" onClick={() => void done(g.id)}>
                    Решено
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * «Сверка и сбои» (части 129–130): сверка с ЮKassa раз в сутки и по кнопке,
 * расхождения — закрыть с пометкой (в журнал); правила тревог и последние
 * тревоги; ошибки API и сайта группами — администратору. Финансам и
 * администратору.
 */
export function OpsSection({ isAdmin }: { isAdmin: boolean }) {
  const [o, setO] = useState<Overview | null>(null);
  const [resolved, setResolved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => {
    apiFetch<Overview>(`/admin/ops${resolved ? '?resolved=1' : ''}`)
      .then(setO)
      .catch((e) => setErr(apiErrorMessage(e, 'Не загрузилось.')));
  }, [resolved]);
  useEffect(load, [load]);

  async function reconcile() {
    setBusy(true);
    setErr(null);
    try {
      await apiFetch('/admin/ops/reconcile', { method: 'POST', body: '{}' });
      load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Сверка не запустилась.'));
    } finally {
      setBusy(false);
    }
  }

  if (!o)
    return err ? (
      <div className="alert error" role="alert">
        {err}
      </div>
    ) : (
      <div className="skeleton" style={{ height: 240 }} aria-busy="true" />
    );
  const r = o.reconciliation;
  const last = r.runs[0];
  const w = o.watch;
  const t = w.thresholds;
  const rules: Array<[string, string, boolean]> = [
    [
      'Ошибок API за 5 минут',
      `${w.state.errors5m} из ${t.errorSpike}`,
      w.state.errors5m >= t.errorSpike,
    ],
    [
      'Неудачных оплат подряд',
      `${w.state.failedInRow} из ${t.failedPayments}`,
      w.state.failedInRow >= t.failedPayments,
    ],
    [
      'Отказов вебхуков за 15 минут',
      `${w.state.webhookFailures15m} из ${t.webhookFailures}`,
      w.state.webhookFailures15m >= t.webhookFailures,
    ],
    [
      `Выплат «отправляется» дольше ${t.payoutStuckHours} ч`,
      String(w.state.stuckPayouts + w.state.stuckDealPayouts),
      w.state.stuckPayouts + w.state.stuckDealPayouts > 0,
    ],
  ];

  return (
    <div className="stack-lg">
      <section className="stack-form" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <h3 className="h2" style={{ fontSize: 18, margin: 0 }}>
            Сверка с ЮKassa
          </h3>
          <button
            type="button"
            className="btn secondary"
            style={{ marginLeft: 'auto' }}
            disabled={busy}
            onClick={() => void reconcile()}
          >
            {busy ? 'Сверяем…' : 'Сверить сейчас'}
          </button>
        </div>
        <p className="hint" style={{ margin: 0 }}>
          Оплаты, возвраты и выплаты в нашем учёте — против ЮKassa. Сама — раз в {r.autoEveryHours}{' '}
          ч за прошедшие сутки, кроме последнего часа: свежий платёж мог ещё не дойти до конца.
        </p>
        {err && (
          <div className="alert error" role="alert">
            {err}
          </div>
        )}
        {last ? (
          <div className="card" style={{ padding: 14, display: 'grid', gap: 4, fontSize: 14 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>
                Последняя — {when(last.startedAt)}
                {last.trigger === 'manual'
                  ? ` · вручную${last.startedBy ? `, ${last.startedBy}` : ''}`
                  : ' · сама'}
              </span>
              <span className={RUN_STATUS[last.status].tone}>{RUN_STATUS[last.status].label}</span>
            </div>
            {last.checked && last.status !== 'skipped' && (
              <span className="faint" style={{ fontSize: 13 }}>
                Сверено: оплат {last.checked.payments}, возвратов {last.checked.refunds}, выплат{' '}
                {last.checked.payouts + last.checked.dealPayouts}
                {last.newIssues ? ` · новых расхождений ${last.newIssues}` : ''}
              </span>
            )}
            {last.error && (
              <span className="faint" style={{ fontSize: 13 }}>
                {last.error}
              </span>
            )}
          </div>
        ) : (
          <Empty>Сверки ещё не было.</Empty>
        )}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="chip"
            aria-pressed={!resolved}
            onClick={() => setResolved(false)}
          >
            Открытые <span className="notif-group-count">{r.open}</span>
          </button>
          <button
            type="button"
            className="chip"
            aria-pressed={resolved}
            onClick={() => setResolved(true)}
          >
            Закрытые
          </button>
        </div>
        {r.issues.length === 0 ? (
          <Empty>{resolved ? 'Закрытых расхождений нет.' : 'Расхождений нет.'}</Empty>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {r.issues.map((i) => (
              <IssueCard key={i.id} issue={i} onResolved={load} />
            ))}
          </div>
        )}
      </section>

      <section className="stack-form" style={{ gap: 12 }}>
        <h3 className="h2" style={{ fontSize: 18, margin: 0 }}>
          Тревоги
        </h3>
        <p className="hint" style={{ margin: 0 }}>
          {w.telegram
            ? 'Правила проверяются раз в минуту; сработало — сообщение в Telegram, одно и то же — не чаще раза в полчаса.'
            : 'Telegram не настроен (ALERT_BOT_TOKEN, ALERT_CHAT_ID) — тревоги видны только здесь.'}
        </p>
        <div className="card" style={{ padding: 14, display: 'grid', gap: 6, fontSize: 14 }}>
          {rules.map(([label, value, hot]) => (
            <div key={label} className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
              <span>{label}</span>
              <span className={hot ? 'badge danger' : 'faint'}>{value}</span>
            </div>
          ))}
        </div>
        {o.alerts.length === 0 ? (
          <Empty>Тревог не было.</Empty>
        ) : (
          <div className="grid" style={{ gap: 0 }}>
            {o.alerts.map((a) => (
              <div
                key={a.id}
                className="row"
                style={{
                  gap: 12,
                  fontSize: 14,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                  flexWrap: 'wrap',
                }}
              >
                <span className="faint" style={{ width: 120, flex: 'none' }}>
                  {when(a.createdAt)}
                </span>
                <span style={{ flex: 1, minWidth: 200 }}>{a.text}</span>
                <span className="faint" style={{ fontSize: 13 }}>
                  {a.sent ? 'в Telegram ✓' : 'только здесь'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {isAdmin && <ErrorsBlock />}
    </div>
  );
}
