'use client';

import { useCallback, useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty, when } from './shared';
import { PAYOUT_REJECT_REASONS } from '@gamemarket/shared';

interface Payout {
  id: string;
  amount: string;
  currency: string;
  method: string;
  status: string;
  createdAt?: string;
  externalId?: string | null;
  destinationHint?: string | null;
}
interface Kyc {
  id: string;
  userId: string;
  level: string;
  status: string;
  createdAt?: string;
  user?: { username: string | null; displayName: string | null; email: string | null; since: string; sales: number };
  files?: Array<{ kind: 'document' | 'selfie'; pdf: boolean; url: string }>;
}

const METHOD: Record<string, string> = { card: 'на карту', sbp: 'по СБП', yoomoney: 'на ЮMoney', usdt: 'в USDT' };

/**
 * Частые причины отказа — подсказкой в поле; текст можно поправить. Выбранная
 * слово в слово уходит продавцу на его языке.
 */
const REJECT_HINTS = PAYOUT_REJECT_REASONS;

/**
 * Заявки на вывод: одобрить или отклонить — деньги двигает API с ролью
 * «финансы». Способы, которые выплачивает ЮKassa, уходят сами после
 * одобрения и висят в «Отправляются», пока шлюз не подтвердит; остальные
 * переводятся вручную — одобрение значит «перевёл». Реквизиты для ручного
 * перевода открываются по кнопке, каждое открытие пишется в журнал. Отказ —
 * только с причиной: продавец увидит её в кошельке и уведомлении.
 */
export function PayoutsSection() {
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [sending, setSending] = useState<Payout[]>([]);
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    setRows(await apiFetch<Payout[]>('/payouts?status=requested').catch(() => []));
    setSending(await apiFetch<Payout[]>('/payouts?status=processing').catch(() => []));
  }, []);
  useEffect(() => {
    apiFetch<Array<{ key: string; auto?: boolean }>>('/payouts/methods')
      .then((m) => setAuto(Object.fromEntries(m.map((x) => [x.key, !!x.auto]))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function act(id: string, action: 'approve' | 'reject') {
    setErr(null);
    const reason = reasons[id]?.trim();
    if (action === 'reject' && !reason) {
      setErr('Напишите причину отказа: продавец увидит её и поймёт, что исправить.');
      return;
    }
    try {
      await apiFetch(`/payouts/${id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { reason } : {}),
      });
      await load();
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось обработать заявку.'));
    }
  }

  async function reveal(id: string) {
    setErr(null);
    try {
      const r = await apiFetch<{ destination: string }>(`/payouts/${id}/destination`);
      setRevealed((m) => ({ ...m, [id]: r.destination }));
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось показать реквизиты.'));
    }
  }

  if (rows === null) return <div className="skeleton" style={{ height: 80 }} aria-busy="true" />;
  return (
    <section className="grid" style={{ gap: 8 }}>
      {err && <div className="alert error" role="alert">{err}</div>}
      <datalist id="payout-reject-hints">
        {REJECT_HINTS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
      {rows.length === 0 ? (
        <Empty>Заявок на вывод нет.</Empty>
      ) : (
        rows.map((p) => (
          <div key={p.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
            <span>
              <span className="price" style={{ fontSize: 16 }}>{formatPrice(p.amount, p.currency)}</span>{' '}
              <span className="faint" style={{ fontSize: 13 }}>
                {METHOD[p.method] ?? p.method}
                {p.destinationHint ? ` ${p.destinationHint}` : ''}
                {auto[p.method] ? ' · через ЮKassa' : ' · вручную'}
                {p.createdAt ? ` · ${when(p.createdAt)}` : ''}
              </span>
              {revealed[p.id] && (
                <code className="secret" style={{ marginTop: 8 }}>{revealed[p.id]}</code>
              )}
            </span>
            <span className="row" style={{ gap: 8 }}>
              {!auto[p.method] && !revealed[p.id] && (
                <button className="chip" onClick={() => void reveal(p.id)} type="button">Реквизиты</button>
              )}
              <button className="btn" onClick={() => void act(p.id, 'approve')} type="button">
                {auto[p.method] ? 'Отправить' : 'Одобрить'}
              </button>
            </span>
            <span className="row" style={{ gap: 8, flexBasis: '100%', flexWrap: 'wrap' }}>
              <input
                className="input"
                style={{ flex: 1, minWidth: 200 }}
                aria-label="Причина отказа"
                placeholder="Причина отказа — её увидит продавец"
                list="payout-reject-hints"
                maxLength={300}
                value={reasons[p.id] ?? ''}
                onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))}
              />
              <button className="chip" onClick={() => void act(p.id, 'reject')} type="button">Отклонить</button>
            </span>
          </div>
        ))
      )}
      {sending.length > 0 && (
        <>
          <h3 className="h2" style={{ fontSize: 16, marginTop: 12 }}>Отправляются через ЮKassa</h3>
          {sending.map((p) => (
            <div key={p.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
              <span>
                <span className="price" style={{ fontSize: 16 }}>{formatPrice(p.amount, p.currency)}</span>{' '}
                <span className="faint" style={{ fontSize: 13 }}>
                  {METHOD[p.method] ?? p.method}
                  {p.destinationHint ? ` ${p.destinationHint}` : ''}
                  {p.externalId ? ` · ${p.externalId}` : ''}
                </span>
              </span>
              <span className="faint" style={{ fontSize: 13 }}>ждём подтверждения ЮKassa</span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

/**
 * Заявки на проверку личности: документ и селфи — на экране, ссылки
 * действуют час. Отказ — с причиной: продавец увидит её и переснимет.
 */
export function KycSection() {
  const [rows, setRows] = useState<Kyc[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    setRows(await apiFetch<Kyc[]>('/kyc/pending').catch(() => []));
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, decision: 'approve' | 'reject') {
    setErr(null);
    const reason = reasons[id]?.trim();
    if (decision === 'reject' && !reason) {
      setErr('Напишите причину отказа: продавец увидит её и переснимет.');
      return;
    }
    try {
      await apiFetch(`/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
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
          <div key={k.id} className="card" style={{ padding: 16 }}>
            <p style={{ margin: 0, fontWeight: 600 }}>
              {k.user?.displayName ?? k.user?.username ?? `Пользователь ${k.userId.slice(0, 8)}`}
              {k.user?.username && k.user.displayName && k.user.displayName !== k.user.username && (
                <span className="faint" style={{ fontWeight: 400 }}> @{k.user.username}</span>
              )}
            </p>
            <p className="faint" style={{ margin: '2px 0 12px', fontSize: 13 }}>
              {k.user?.email ?? 'без почты'} · на площадке с {k.user ? when(k.user.since) : '—'} · продаж:{' '}
              {k.user?.sales ?? 0}
              {k.createdAt ? ` · заявка ${when(k.createdAt)}` : ''}
            </p>
            <div className="kyc-review-files">
              {(k.files ?? []).map((f, i) => (
                <a key={i} href={f.url} target="_blank" rel="noreferrer" className="kyc-review-file">
                  {f.pdf ? (
                    <span className="kyc-file-doc">
                      <FileText size={22} strokeWidth={1.75} aria-hidden /> PDF
                    </span>
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.url} alt={f.kind === 'selfie' ? 'Селфи с документом' : 'Документ'} />
                  )}
                  <span>{f.kind === 'selfie' ? 'Селфи' : 'Документ'}</span>
                </a>
              ))}
            </div>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn" onClick={() => void review(k.id, 'approve')} type="button">
                Одобрить
              </button>
              <input
                className="input"
                style={{ flex: 1, minWidth: 180 }}
                aria-label="Причина отказа"
                placeholder="Причина отказа: размыто, нет селфи…"
                maxLength={300}
                value={reasons[k.id] ?? ''}
                onChange={(e) => setReasons((r) => ({ ...r, [k.id]: e.target.value }))}
              />
              <button className="chip" onClick={() => void review(k.id, 'reject')} type="button">
                Отклонить
              </button>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
