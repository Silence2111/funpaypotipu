'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ruleAnchor } from '@gamemarket/shared/rules';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty, StatusBadge, USER_STATUS, when } from './shared';
import { useDecisionDialog } from './decision-dialog';

interface Appeal {
  id: string;
  status: 'open' | 'upheld' | 'overturned';
  text: string;
  note: string | null;
  createdAt: string;
  dueAt: string;
  escalatedAt: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
  user: { id: string; status: string; username: string | null };
  decision: {
    id: string;
    kind: string;
    targetType: string;
    targetId: string;
    reason: string | null;
    rule: string | null;
    ruleText: string | null;
    at: string;
    by: string | null;
    byId: string | null;
  };
}
interface Hold {
  id: string;
  userId: string;
  username: string | null;
  amount: string;
  currency: string;
  reason: string;
  ruleText: string | null;
  createdAt: string;
}

const OUTCOME: Record<string, string> = { upheld: 'Решение оставлено', overturned: 'Решение отменено' };

/**
 * Обжалования и удержания (часть 134). Обжалование решает другой
 * сотрудник: у своего решения кнопок нет. «Отменить» возвращает как было —
 * снимает заморозку, блокировку лота, запрет писать, удержание, возвращает
 * сообщение. Просроченные (дольше 48 ч) — сверху с пометкой.
 */
export function AppealsSection({ meId }: { meId: string | null }) {
  const { dialog, ask } = useDecisionDialog();
  const [tab, setTab] = useState<'open' | 'decided'>('open');
  const [rows, setRows] = useState<Appeal[] | null>(null);
  const [holds, setHolds] = useState<Hold[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, h] = await Promise.all([
      apiFetch<Appeal[]>(`/moderation/appeals${tab === 'decided' ? '?status=decided' : ''}`),
      apiFetch<Hold[]>('/moderation/holds'),
    ]);
    setRows(a);
    setHolds(h);
  }, [tab]);

  useEffect(() => {
    setRows(null);
    load().catch((e) => setErr(apiErrorMessage(e, 'Не удалось загрузить обжалования.')));
  }, [load]);

  async function decide(a: Appeal, outcome: 'upheld' | 'overturned') {
    const d = await ask({
      title: outcome === 'overturned' ? 'Отменить решение?' : 'Оставить решение в силе?',
      hint: 'Ответ увидит человек.',
      withRule: false,
      confirm: outcome === 'overturned' ? 'Отменить решение' : 'Оставить',
    });
    if (!d) return;
    setBusy(a.id);
    setErr(null);
    try {
      await apiFetch(`/moderation/appeals/${a.id}/decide`, { method: 'POST', body: JSON.stringify({ outcome, note: d.reason }) });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось решить обжалование.'));
    } finally {
      setBusy(null);
    }
  }

  async function release(h: Hold) {
    const d = await ask({ title: `Снять удержание ${formatPrice(h.amount)}?`, withRule: false, reason: 'Проверка закончена', confirm: 'Снять' });
    if (!d) return;
    setBusy(h.id);
    try {
      await apiFetch(`/moderation/holds/${h.id}/release`, { method: 'POST', body: JSON.stringify({ note: d.reason }) });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось снять удержание.'));
    } finally {
      setBusy(null);
    }
  }

  const target = (a: Appeal) =>
    a.decision.targetType === 'listing' ? (
      <Link href={`/lot/${a.decision.targetId}`}>лот</Link>
    ) : a.decision.targetType === 'game_chat' ? (
      <span>сообщение в чате игры</span>
    ) : null;

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      {dialog}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="chip" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>Ждут решения</button>
        <button type="button" className="chip" aria-pressed={tab === 'decided'} onClick={() => setTab('decided')}>Решённые</button>
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        <Empty>{tab === 'open' ? 'Обжалований нет.' : 'Решённых пока нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((a) => {
            const own = !!meId && a.decision.byId === meId;
            const late = a.status === 'open' && new Date(a.dueAt) < new Date();
            return (
              <div key={a.id} className="card" style={{ padding: 16, display: 'grid', gap: 8 }}>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
                  <Link href={`/prodavec/${a.user.id}`} style={{ fontWeight: 600 }}>{a.user.username ?? a.user.id.slice(0, 8)}</Link>
                  <StatusBadge status={a.user.status} labels={USER_STATUS} />
                  <span className="faint">{when(a.createdAt)}</span>
                  {late && <span className="badge danger">просрочено — ответить до {when(a.dueAt)}</span>}
                  {a.status !== 'open' && <span className="badge">{OUTCOME[a.status]}</span>}
                </div>
                <div className="card flat" style={{ padding: 12, background: 'var(--page)', fontSize: 14 }}>
                  <div>
                    <b>{a.decision.kind}</b> {target(a)} · {when(a.decision.at)} · {a.decision.by ?? 'система'}
                  </div>
                  {a.decision.ruleText && (
                    <div className="faint">
                      <Link href={`/rules#${ruleAnchor(a.decision.rule!)}`}>{a.decision.ruleText}</Link>
                    </div>
                  )}
                  {a.decision.reason && <div>«{a.decision.reason}»</div>}
                </div>
                <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{a.text}</p>
                {a.status === 'open' ? (
                  own ? (
                    <p className="hint" style={{ margin: 0 }}>Это ваше решение — обжалование решает другой сотрудник.</p>
                  ) : (
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <button type="button" className="btn" disabled={busy === a.id} onClick={() => void decide(a, 'overturned')}>Отменить решение</button>
                      <button type="button" className="chip" disabled={busy === a.id} onClick={() => void decide(a, 'upheld')}>Оставить в силе</button>
                    </div>
                  )
                ) : (
                  <p className="hint" style={{ margin: 0 }}>
                    {a.decidedBy ?? 'сотрудник'} · {a.decidedAt ? when(a.decidedAt) : ''}{a.note ? ` · «${a.note}»` : ''}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <h2 className="h2" style={{ fontSize: 18, margin: '8px 0 0' }}>Удержанные суммы</h2>
      {holds === null ? null : holds.length === 0 ? (
        <Empty>Удержаний нет.</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {holds.map((h) => (
            <div key={h.id} className="card row" style={{ padding: 14, gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 14 }}>
                <Link href={`/prodavec/${h.userId}`} style={{ fontWeight: 600 }}>{h.username ?? h.userId.slice(0, 8)}</Link>
                {' · '}<b>{formatPrice(h.amount)}</b>{' · '}{when(h.createdAt)}
                <span className="faint" style={{ display: 'block' }}>{h.ruleText ? `${h.ruleText} · ` : ''}«{h.reason}»</span>
              </span>
              <button type="button" className="chip" disabled={busy === h.id} onClick={() => void release(h)}>Снять удержание</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
