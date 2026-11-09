'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FileText } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { isCurrentQuery, replaceUrl, withQuery } from '@/lib/url';
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
  /** Причина отказа — продавец видит её в кошельке. */
  rejectReason?: string | null;
  /** Когда решили: у выплаченных и отклонённых. */
  updatedAt?: string;
  /** Чей вывод. */
  seller?: { id: string; username: string | null; email: string | null };
  /** Кто одобрил или отклонил. */
  decidedBy?: string | null;
  /** Почему не прошла автоматическая выплата. */
  failureReason?: string | null;
}
interface Kyc {
  id: string;
  userId: string;
  level: string;
  status: string;
  /** Почему отклонили — продавец видит её у себя. */
  reason?: string | null;
  createdAt?: string;
  reviewedAt?: string | null;
  reviewer?: string | null;
  user?: { username: string | null; displayName: string | null; email: string | null; since: string; sales: number };
  files?: Array<{ kind: 'document' | 'selfie'; pdf: boolean; url: string }>;
}

const METHOD: Record<string, string> = { card: 'на карту', sbp: 'по СБП', yoomoney: 'на ЮMoney', usdt: 'в USDT' };

/**
 * Частые причины отказа — подсказкой в поле; текст можно поправить. Выбранная
 * слово в слово уходит продавцу на его языке.
 */
const REJECT_HINTS = PAYOUT_REJECT_REASONS;

type PayoutStatus = 'requested' | 'processing' | 'paid' | 'rejected';
type PayoutCounts = Record<PayoutStatus | 'approved', number>;
interface PayoutPage {
  items: Payout[];
  /** С какой заявки продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  /** Сколько в каждом статусе; в поиске — найденных. */
  counts: PayoutCounts;
}
const PAYOUT_FILTERS: Array<{ key: PayoutStatus; label: string }> = [
  { key: 'requested', label: 'Ждут решения' },
  { key: 'processing', label: 'Отправляются' },
  { key: 'paid', label: 'Выплачены' },
  { key: 'rejected', label: 'Отклонены' },
];
const readPayoutStatus = (v: string | null): PayoutStatus =>
  PAYOUT_FILTERS.find((f) => f.key === v)?.key ?? 'requested';
/** Адрес очереди с фильтром и поиском — ссылкой открывается тот же список. */
const payoutsUrl = (status: PayoutStatus, q: string) =>
  withQuery('/admin', { tab: 'payouts', status: status !== 'requested' && status, q: q.trim() });

/**
 * Заявки на вывод: одобрить или отклонить — деньги двигает API с ролью
 * «финансы». Способы, которые выплачивает ЮKassa, уходят сами после
 * одобрения и висят в «Отправляются», пока шлюз не подтвердит; остальные
 * переводятся вручную — одобрение значит «перевёл». Реквизиты для ручного
 * перевода открываются по кнопке, каждое открытие пишется в журнал. Отказ —
 * только с причиной: продавец увидит её в кошельке и уведомлении.
 *
 * У заявки — чей вывод: ник со ссылкой на продавца и почта. Ждущие — от
 * старых к новым, выплаченные и отклонённые — свежие решения сверху, с тем,
 * кто решал; по 50 и «Показать ещё», поиск по нику, почте и номеру у
 * ЮKassa. Раньше приходили все заявки разом и без продавца, а выплаченных и
 * отклонённых здесь не было. Фильтр и поиск — в адресе страницы.
 */
export function PayoutsSection() {
  const params = useSearchParams();
  const [status, setStatus] = useState<PayoutStatus>(readPayoutStatus(params.get('status')));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<PayoutCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  // Ответ на прежний фильтр или поиск новый список не перетирает.
  const current = useRef('');

  useEffect(() => {
    apiFetch<Array<{ key: string; auto?: boolean }>>('/payouts/methods')
      .then((m) => setAuto(Object.fromEntries(m.map((x) => [x.key, !!x.auto]))))
      .catch(() => {});
  }, []);

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setStatus(readPayoutStatus(params.get('status')));
    setQuery(params.get('q') ?? '');
    setText(params.get('q') ?? '');
  }, [params]);

  function go(change: { status?: PayoutStatus; q?: string }) {
    const st = change.status ?? status;
    const q = (change.q ?? query).trim();
    setStatus(st);
    setQuery(q);
    replaceUrl(payoutsUrl(st, q));
  }

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ status });
      if (query) p.set('q', query);
      if (cursor) p.set('cursor', cursor);
      return `/payouts?${p}`;
    },
    [status, query],
  );

  useEffect(() => {
    const key = url();
    current.current = key;
    setRows(null);
    setErr(null);
    apiFetch<PayoutPage>(key)
      .then((p) => {
        if (current.current !== key) return;
        setRows(p.items);
        setNext(p.next);
        setCounts(p.counts);
      })
      .catch((e) => {
        if (current.current !== key) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, 'Не удалось загрузить заявки.'));
      });
  }, [url]);

  async function more() {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<PayoutPage>(url(next));
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((x) => x.id));
        return [...(prev ?? []), ...p.items.filter((x) => !seen.has(x.id))];
      });
      setNext(p.next);
      setCounts(p.counts);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось загрузить заявки.'));
    } finally {
      setBusy(false);
    }
  }

  async function act(p: Payout, action: 'approve' | 'reject') {
    setErr(null);
    const reason = reasons[p.id]?.trim();
    if (action === 'reject' && !reason) {
      setErr('Напишите причину отказа: продавец увидит её и поймёт, что исправить.');
      return;
    }
    try {
      await apiFetch(`/payouts/${p.id}/${action}`, {
        method: 'POST',
        body: JSON.stringify(action === 'reject' ? { reason } : {}),
      });
      // Решённая заявка уходит из «Ждут решения» сразу — подгруженные
      // страницы остаются на месте, счётчики сдвигаются: через ЮKassa — в
      // «Отправляются», вручную — в «Выплачены».
      setRows((prev) => prev?.filter((x) => x.id !== p.id) ?? prev);
      const to: PayoutStatus = action === 'reject' ? 'rejected' : auto[p.method] ? 'processing' : 'paid';
      setCounts((c) => c && { ...c, requested: Math.max(0, c.requested - 1), [to]: c[to] + 1 });
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

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник, почта или номер у ЮKassa"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск заявок на вывод" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {PAYOUT_FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => go({ status: f.key })}>
            {f.label}
            {counts && <span className="notif-group-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      <datalist id="payout-reject-hints">
        {REJECT_HINTS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
      {rows === null ? (
        <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Ничего не нашлось.' : status === 'requested' ? 'Заявок на вывод нет.' : 'Таких заявок нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((p) => (
            <div key={p.id} className="card row" style={{ justifyContent: 'space-between', padding: 16, gap: 12, flexWrap: 'wrap' }}>
              <span>
                <span className="price" style={{ fontSize: 16 }}>{formatPrice(p.amount, p.currency)}</span>{' '}
                {p.seller && (
                  <>
                    <Link href={`/prodavec/${p.seller.id}`} style={{ fontWeight: 600 }}>
                      {p.seller.username ?? p.seller.id.slice(0, 8)}
                    </Link>{' '}
                  </>
                )}
                <span className="faint" style={{ fontSize: 13 }}>
                  {[
                    p.seller?.email,
                    `${METHOD[p.method] ?? p.method}${p.destinationHint ? ` ${p.destinationHint}` : ''}`,
                    auto[p.method] ? 'через ЮKassa' : 'вручную',
                    p.externalId,
                    p.createdAt ? when(p.createdAt) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {revealed[p.id] && (
                  <code className="secret" style={{ marginTop: 8 }}>{revealed[p.id]}</code>
                )}
              </span>
              {p.status === 'requested' ? (
                <>
                  <span className="row" style={{ gap: 8 }}>
                    {!auto[p.method] && !revealed[p.id] && (
                      <button className="chip" onClick={() => void reveal(p.id)} type="button">Реквизиты</button>
                    )}
                    <button className="btn" onClick={() => void act(p, 'approve')} type="button">
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
                    <button className="chip" onClick={() => void act(p, 'reject')} type="button">Отклонить</button>
                  </span>
                </>
              ) : (
                <span className="faint" style={{ fontSize: 13, flexBasis: '100%' }}>
                  {p.status === 'processing' || p.status === 'approved'
                    ? 'ждём подтверждения ЮKassa'
                    : `${p.status === 'paid' ? 'Выплачено' : 'Отклонено'}${p.updatedAt ? ` ${when(p.updatedAt)}` : ''}${p.decidedBy ? ` · ${p.decidedBy}` : ''}${p.status === 'rejected' && p.rejectReason ? ` · «${p.rejectReason}»` : ''}`}
                  {p.failureReason ? ` · ЮKassa: ${p.failureReason}` : ''}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {!!rows?.length && (next || counts) && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void more()}>
              {busy ? '…' : 'Показать ещё'}
            </button>
          )}
          {counts && (
            <span className="faint" style={{ fontSize: 13 }}>
              Показано {rows.length} из {counts[status]}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

type KycStatus = 'pending' | 'approved' | 'rejected';
type KycCounts = Record<KycStatus, number>;
interface KycPage {
  items: Kyc[];
  /** С какой заявки продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
  /** Сколько в каждом статусе; в поиске — найденных. */
  counts: KycCounts;
}
const KYC_FILTERS: Array<{ key: KycStatus; label: string }> = [
  { key: 'pending', label: 'Ждут проверки' },
  { key: 'approved', label: 'Одобрены' },
  { key: 'rejected', label: 'Отклонены' },
];
const readKycStatus = (v: string | null): KycStatus => KYC_FILTERS.find((f) => f.key === v)?.key ?? 'pending';
/** Адрес очереди с фильтром и поиском — ссылкой открывается тот же список. */
const kycUrl = (status: KycStatus, q: string) =>
  withQuery('/admin', { tab: 'kyc', status: status !== 'pending' && status, q: q.trim() });

/**
 * Заявки на проверку личности: документ и селфи — на экране, ссылки
 * действуют час. Отказ — с причиной: продавец увидит её и переснимет.
 *
 * Ждущие — от старых к новым, решённые — свежие решения сверху, с причиной
 * и тем, кто решал; по 50 и «Показать ещё», поиск по нику, имени и почте.
 * Раньше приходили все ждущие разом, с фото каждой, а решённых не было.
 * Фильтр и поиск — в адресе страницы.
 */
export function KycSection() {
  const params = useSearchParams();
  const [status, setStatus] = useState<KycStatus>(readKycStatus(params.get('status')));
  const [text, setText] = useState(params.get('q') ?? '');
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [rows, setRows] = useState<Kyc[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [counts, setCounts] = useState<KycCounts | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  // Ответ на прежний фильтр или поиск новый список не перетирает.
  const current = useRef('');

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    setStatus(readKycStatus(params.get('status')));
    setQuery(params.get('q') ?? '');
    setText(params.get('q') ?? '');
  }, [params]);

  function go(change: { status?: KycStatus; q?: string }) {
    const s = change.status ?? status;
    const q = (change.q ?? query).trim();
    setStatus(s);
    setQuery(q);
    replaceUrl(kycUrl(s, q));
  }

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams({ status });
      if (query) p.set('q', query);
      if (cursor) p.set('cursor', cursor);
      return `/kyc/queue?${p}`;
    },
    [status, query],
  );

  useEffect(() => {
    const key = url();
    current.current = key;
    setRows(null);
    setErr(null);
    apiFetch<KycPage>(key)
      .then((p) => {
        if (current.current !== key) return;
        setRows(p.items);
        setNext(p.next);
        setCounts(p.counts);
      })
      .catch((e) => {
        if (current.current !== key) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, 'Не удалось загрузить заявки.'));
      });
  }, [url]);

  async function more() {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<KycPage>(url(next));
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((k) => k.id));
        return [...(prev ?? []), ...p.items.filter((k) => !seen.has(k.id))];
      });
      setNext(p.next);
      setCounts(p.counts);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось загрузить заявки.'));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, decision: 'approve' | 'reject') {
    setErr(null);
    const reason = reasons[id]?.trim();
    if (decision === 'reject' && !reason) {
      setErr('Напишите причину отказа: продавец увидит её и переснимет.');
      return;
    }
    try {
      await apiFetch(`/kyc/${id}/review`, { method: 'POST', body: JSON.stringify({ decision, reason }) });
      // Решённая заявка уходит из «Ждут проверки» сразу — подгруженные
      // страницы остаются на месте, счётчики сдвигаются.
      setRows((prev) => prev?.filter((k) => k.id !== id) ?? prev);
      const to: KycStatus = decision === 'approve' ? 'approved' : 'rejected';
      setCounts((c) => c && { ...c, pending: Math.max(0, c.pending - 1), [to]: c[to] + 1 });
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось сохранить решение.'));
    }
  }

  return (
    <section className="stack-form" style={{ gap: 16 }}>
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          go({ q: text });
        }}
        className="row"
        style={{ gap: 8, flexWrap: 'wrap' }}
      >
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник, имя или почта"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск заявок на проверку" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {KYC_FILTERS.map((f) => (
          <button key={f.key} type="button" className="chip" aria-pressed={status === f.key} onClick={() => go({ status: f.key })}>
            {f.label}
            {counts && <span className="notif-group-count">{counts[f.key]}</span>}
          </button>
        ))}
      </div>
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{query ? 'Ничего не нашлось.' : status === 'pending' ? 'Заявок на проверку нет.' : 'Таких заявок нет.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 8 }}>
          {rows.map((k) => (
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
                      <img src={f.url} alt={f.kind === 'selfie' ? 'Селфи с документом' : 'Документ'} loading="lazy" />
                    )}
                    <span>{f.kind === 'selfie' ? 'Селфи' : 'Документ'}</span>
                  </a>
                ))}
              </div>
              {k.status === 'pending' ? (
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
              ) : (
                <p className="hint" style={{ marginTop: 12 }}>
                  {k.status === 'approved' ? 'Одобрена' : 'Отклонена'}
                  {k.reviewedAt ? ` ${when(k.reviewedAt)}` : ''}
                  {k.reviewer ? ` · ${k.reviewer}` : ''}
                  {k.status === 'rejected' && k.reason ? ` · «${k.reason}»` : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
      {!!rows?.length && (next || counts) && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void more()}>
              {busy ? '…' : 'Показать ещё'}
            </button>
          )}
          {counts && (
            <span className="faint" style={{ fontSize: 13 }}>
              Показано {rows.length} из {counts[status]}
            </span>
          )}
        </div>
      )}
    </section>
  );
}
