'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { isCurrentQuery, isPlainClick, replaceUrl, withQuery } from '@/lib/url';
import { Empty, ROLE_LABEL } from './shared';

interface Entry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: string | null;
  actorId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
  /** О ком или о чём запись: владелец выплаты или проверки, сумма, номер заказа спора, лот. */
  target: {
    userId: string | null;
    username: string | null;
    amount: string | null;
    currency: string | null;
    number: string | null;
    title: string | null;
  };
}

interface Page {
  items: Entry[];
  /** С какой записи продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
}

type Kind = 'payouts' | 'moderation' | 'disputes' | 'kyc' | 'recovery' | 'access' | 'settings' | 'catalog';
const KINDS: Array<{ key: Kind | null; label: string }> = [
  { key: null, label: 'Все' },
  { key: 'payouts', label: 'Выплаты' },
  { key: 'moderation', label: 'Модерация' },
  { key: 'disputes', label: 'Споры' },
  { key: 'kyc', label: 'Проверка личности' },
  { key: 'recovery', label: 'Восстановление' },
  { key: 'access', label: 'Роли и почта' },
  { key: 'settings', label: 'Комиссии и курсы' },
  { key: 'catalog', label: 'Каталог' },
];
const readKind = (v: string | null): Kind | null => KINDS.find((k) => k.key === v)?.key ?? null;

/** Понятные названия действий журнала; незнакомое показывается как есть. */
const ACTION: Record<string, string> = {
  'payout.approve': 'выплата одобрена',
  'payout.send': 'выплата отправлена в ЮKassa',
  'payout.reveal': 'открыты реквизиты выплаты',
  'payout.reject': 'отказ в выводе',
  'moderation.warn': 'предупреждение',
  'moderation.ban': 'бан',
  'moderation.block': 'блокировка',
  'moderation.unblock': 'снятие блокировки',
  'moderation.hide': 'скрыто модератором',
  'partner.settings': 'партнёрская программа',
  'moderation.delete': 'удалено модератором',
  'report.resolved': 'жалоба решена',
  'report.rejected': 'жалоба отклонена',
  'report.reviewing': 'жалоба взята в работу',
  'dispute.request': 'запрос стороне спора',
  'dispute.resolve.buyer': 'спор решён в пользу покупателя',
  'dispute.resolve.seller': 'спор решён в пользу продавца',
  'kyc.approve': 'проверка личности одобрена',
  'kyc.reject': 'проверка личности отклонена',
  'recovery.request_docs': 'восстановление: запрошены документы',
  'recovery.request_deals': 'восстановление: запрошены сделки',
  'recovery.request_card': 'восстановление: запрошен платёж 1 ₽',
  'recovery.restore': 'доступ восстановлен',
  'recovery.restore_new_email': 'доступ восстановлен на новую почту',
  'recovery.reject': 'в восстановлении отказано',
  'role.assign': 'выдана роль',
  'role.revoke': 'снята роль',
  'email.change': 'почта изменена',
  'email.revert': 'почта возвращена — «Это не я»',
  'rates.set': 'курсы для показа цен',
  'fee.create': 'новое правило комиссии',
  'fee.update': 'правило комиссии изменено',
  'catalog.game.create': 'новая игра',
  'catalog.game.update': 'игра изменена',
  'catalog.game.cover': 'обложка игры',
  'catalog.category.create': 'новый раздел',
  'catalog.category.update': 'раздел изменён',
  'catalog.category.order': 'порядок разделов',
  'catalog.attribute.create': 'новое поле',
  'catalog.attribute.update': 'поле изменено',
  'catalog.attribute.delete': 'поле убрано',
  'catalog.attribute.order': 'порядок полей',
};
/** Что сравнивать у игры, раздела и поля каталога: было → стало. */
const CATALOG_FIELD: Record<string, string> = {
  title: 'название',
  label: 'подпись',
  kind: 'вид',
  sortOrder: 'место в популярных',
  isActive: 'на витрине',
  segment: 'тип товара',
  fulfillmentType: 'выдача',
  isRequired: 'обязательное',
  isFilter: 'в фильтрах',
  unitName: 'единица',
  pricePerUnits: 'цена за',
};
const catalogValue = (v: unknown) =>
  typeof v === 'boolean' ? (v ? 'да' : 'нет') : Array.isArray(v) ? v.join(', ') : v === null || v === undefined ? '—' : String(v);

const SIDE: Record<string, string> = { buyer: 'покупателя', seller: 'продавца' };
const PROOF: Record<string, string> = { card: 'по карте', documents: 'по документам', deals: 'по сделкам' };
const REPORT_ACTION: Record<string, string> = {
  warn: 'предупреждение',
  hide: 'скрыто',
  delete: 'удалено',
  block: 'блокировка',
  ban: 'бан',
};
const FEE_FIELD: Record<string, string> = {
  feeSellerPct: 'с продавца',
  feeBuyerPct: 'с покупателя',
  feeFixed: 'фикс., коп.',
  priority: 'приоритет',
  active: 'включено',
};

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : String(v));
const pct = (v: unknown) =>
  typeof v === 'number' ? `${(v * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 })}%` : String(v);
const feeValue = (k: string, v: unknown) =>
  k.endsWith('Pct') ? pct(v) : typeof v === 'boolean' ? (v ? 'да' : 'нет') : String(v);

/** Дата записи; прошлогодние — с годом: журнал хранится годами. */
function stamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Что именно сделано: роль, курс, было → стало, кому письмо, причина. */
function details(r: Entry): string[] {
  const a = r.after ?? {};
  const b = r.before ?? {};
  const out: string[] = [];
  const role = str(a.roleKey);
  if (role) out.push(`«${ROLE_LABEL[role] ?? role}»`);
  if (r.action === 'rates.set') out.push(`USD ${num(a.USD)} ₽ · EUR ${num(a.EUR)} ₽`);
  if (r.action === 'fee.create') {
    out.push(`с продавца ${pct(a.feeSellerPct)} · с покупателя ${pct(a.feeBuyerPct)}`);
  }
  if (r.action === 'partner.settings') {
    // Было → стало: включена, доля и срок.
    const show = (v: Record<string, unknown>) =>
      v.enabled === true
        ? `включена, ${(Number(v.shareBps) || 0) / 100}%, ${Number(v.termDays) || 0} дн.`
        : 'выключена';
    out.push(`${show(b)} → ${show(a)}`);
  }
  if (r.action === 'fee.update') {
    for (const [k, label] of Object.entries(FEE_FIELD)) {
      if (b[k] !== a[k]) out.push(`${label}: ${feeValue(k, b[k])} → ${feeValue(k, a[k])}`);
    }
  }
  if (str(b.email) && str(a.email)) out.push(`${b.email} → ${a.email}`);
  const proof = str(a.proof);
  if (proof) out.push(PROOF[proof] ?? proof);
  const to = str(a.to);
  if (to) out.push(`письмо на ${to}`);
  const side = str(a.side);
  if (r.action === 'dispute.request' && side) out.push(`ответа ждём от ${SIDE[side] ?? side}`);
  const ext = str(a.externalId);
  if (ext) out.push(`№ ${ext} у ЮKassa`);
  if (r.action.startsWith('catalog.') && r.before && r.after) {
    for (const [k, label] of Object.entries(CATALOG_FIELD)) {
      if (k in a && JSON.stringify(b[k]) !== JSON.stringify(a[k])) out.push(`${label}: ${catalogValue(b[k])} → ${catalogValue(a[k])}`);
    }
    if (JSON.stringify(b.aliases) !== JSON.stringify(a.aliases) && 'aliases' in a) out.push('синонимы изменены');
    if (JSON.stringify(b.options) !== JSON.stringify(a.options) && 'options' in a) out.push(`варианты: ${catalogValue(a.options)}`);
  }
  if (r.action.startsWith('report.')) {
    const act = str(a.action);
    if (act) out.push(REPORT_ACTION[act] ?? act);
    if (typeof a.reports === 'number' && a.reports > 1) out.push(`жалоб: ${a.reports}`);
  }
  return out;
}

/** О ком или о чём запись — словами, а не голым id. */
function targetLabel(r: Entry) {
  const t = r.target;
  const short = r.entityId.slice(0, 8);
  switch (r.entityType) {
    case 'user':
      return t.username ?? `пользователь ${short}`;
    case 'payout':
      return `выплата ${t.amount && t.currency ? formatPrice(t.amount, t.currency) : short}${t.username ? ` · ${t.username}` : ''}`;
    case 'kyc':
      return `проверка личности${t.username ? ` · ${t.username}` : ` ${short}`}`;
    case 'dispute':
      return `спор ${t.number ?? short}`;
    case 'listing':
      return t.title ? `лот «${t.title}»` : `лот ${short}`;
    case 'report':
      return `жалоба ${short}`;
    case 'buy_request': {
      const text = str(((r.after ?? r.before ?? {}) as Record<string, unknown>).text);
      return text ? `запрос «${text.length > 60 ? `${text.slice(0, 60)}…` : text}»` : `запрос ${short}`;
    }
    case 'setting':
      return r.entityId === 'display_rates'
        ? 'курсы валют'
        : r.entityId === 'partner_program'
          ? 'партнёрская программа'
          : r.entityId;
    case 'fee_rule':
      return `правило ${short}`;
    case 'game':
    case 'category':
    case 'attribute': {
      // Название — из снимка в самой записи: так видно и убранное поле.
      const snap = (r.after ?? r.before ?? {}) as Record<string, unknown>;
      const name = str(snap.title) ?? str(snap.label);
      const what = r.entityType === 'game' ? 'игра' : r.entityType === 'category' ? 'раздел' : 'поле';
      return name ? `${what} «${name}»` : `${what} ${short}`;
    }
    default:
      return `${r.entityType} ${short}`;
  }
}

/** Страница объекта, если она есть: продавец, спор, лот. */
function targetHref(r: Entry) {
  if (r.entityType === 'dispute') return `/disputes/${r.entityId}`;
  if (r.entityType === 'listing') return `/lot/${r.entityId}`;
  if (r.target.userId) return `/prodavec/${r.target.userId}`;
  return null;
}

interface Filters {
  kind: Kind | null;
  actor: string;
  entity: string;
  q: string;
}

const read = (p: URLSearchParams | { get(k: string): string | null }): Filters => ({
  kind: readKind(p.get('kind')),
  actor: p.get('actor') ?? '',
  entity: p.get('entity') ?? '',
  q: p.get('q') ?? '',
});

/** Адрес журнала с фильтрами — ссылкой открывается тот же список. */
const auditUrl = (f: Filters) =>
  withQuery('/admin', { tab: 'audit', kind: f.kind, actor: f.actor, entity: f.entity, q: f.q.trim() });

/**
 * Журнал: кто из сотрудников что сделал — деньги, модерация, права. По 50 и
 * «Показать ещё», свежие сверху; разделы; клик по сотруднику — все его
 * действия, по объекту — вся история выплаты, спора или пользователя; поиск
 * по нику, почте и id. У записи — о ком она и что именно сделано. Раньше
 * здесь были 150 последних записей без фильтров, а действия выплат,
 * проверки личности и восстановления показывались ключами вроде
 * `payout.send`. Фильтры — в адресе страницы.
 */
export function AuditSection() {
  const params = useSearchParams();
  const [f, setF] = useState<Filters>(() => read(params));
  const [text, setText] = useState(f.q);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Подписи активных фильтров — с записи, по которой кликнули.
  const [labels, setLabels] = useState<{ actor?: string; entity?: string }>({});
  // Ответ на прежние фильтры новый список не перетирает.
  const current = useRef('');

  // Адрес сменили снаружи (ссылкой) — список за ним.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    const n = read(params);
    setF(n);
    setText(n.q);
  }, [params]);

  function go(change: Partial<Filters>) {
    const n = { ...f, ...change, q: (change.q ?? f.q).trim() };
    setF(n);
    replaceUrl(auditUrl(n));
  }

  /** Ссылка-фильтр: обычный клик — на месте, с Ctrl или колёсиком — в новой вкладке. */
  const filterLink = (change: Partial<Filters>, label: { actor?: string; entity?: string }) => ({
    href: auditUrl({ ...f, ...change }),
    onClick: (e: MouseEvent) => {
      if (!isPlainClick(e)) return;
      e.preventDefault();
      setLabels((l) => ({ ...l, ...label }));
      go(change);
    },
  });

  const url = useCallback(
    (cursor?: string) => {
      const p = new URLSearchParams();
      if (f.kind) p.set('kind', f.kind);
      if (f.actor) p.set('actor', f.actor);
      if (f.entity) p.set('entity', f.entity);
      if (f.q) p.set('q', f.q);
      if (cursor) p.set('cursor', cursor);
      const s = p.toString();
      return s ? `/admin/audit?${s}` : '/admin/audit';
    },
    [f],
  );

  useEffect(() => {
    const key = url();
    current.current = key;
    setRows(null);
    setErr(null);
    apiFetch<Page>(key)
      .then((p) => {
        if (current.current !== key) return;
        setRows(p.items);
        setNext(p.next);
      })
      .catch((e) => {
        if (current.current !== key) return;
        setRows([]);
        setNext(null);
        setErr(apiErrorMessage(e, 'Не удалось загрузить журнал.'));
      });
  }, [url]);

  async function more() {
    if (!next || busy) return;
    const key = current.current;
    setBusy(true);
    setErr(null);
    try {
      const p = await apiFetch<Page>(url(next));
      if (current.current !== key) return;
      setRows((prev) => {
        const seen = new Set((prev ?? []).map((r) => r.id));
        return [...(prev ?? []), ...p.items.filter((r) => !seen.has(r.id))];
      });
      setNext(p.next);
    } catch (e) {
      setErr(apiErrorMessage(e, 'Не удалось загрузить журнал.'));
    } finally {
      setBusy(false);
    }
  }

  // Открыли по ссылке — подпись фильтра берём с первой подходящей записи.
  const actorLabel = labels.actor ?? rows?.find((r) => r.actorId === f.actor)?.actor ?? f.actor.slice(0, 8);
  const entityRow = rows?.find((r) => `${r.entityType}:${r.entityId}` === f.entity);
  const entityLabel = labels.entity ?? (entityRow ? targetLabel(entityRow) : f.entity.slice(f.entity.indexOf(':') + 1, f.entity.indexOf(':') + 9));

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
        <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="Ник, почта или id"
          value={text} onChange={(e) => setText(e.target.value)} aria-label="Поиск по журналу" />
        <button className="btn secondary" type="submit">Найти</button>
      </form>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {KINDS.map((k) => (
          <button key={k.key ?? 'all'} type="button" className="chip" aria-pressed={f.kind === k.key} onClick={() => go({ kind: k.key })}>
            {k.label}
          </button>
        ))}
      </div>
      {(f.actor || f.entity) && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {f.actor && (
            <button type="button" className="chip" aria-label={`Убрать фильтр: сотрудник ${actorLabel}`} onClick={() => go({ actor: '' })}>
              сотрудник {actorLabel} <span aria-hidden="true">✕</span>
            </button>
          )}
          {f.entity && (
            <button type="button" className="chip" aria-label={`Убрать фильтр: ${entityLabel}`} onClick={() => go({ entity: '' })}>
              история: {entityLabel} <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
      )}
      {err && <div className="alert error" role="alert">{err}</div>}
      {rows === null ? (
        <div className="skeleton" style={{ height: 120 }} aria-busy="true" />
      ) : rows.length === 0 ? (
        err ? null : <Empty>{f.q || f.actor || f.entity || f.kind ? 'Ничего не нашлось.' : 'Журнал пуст.'}</Empty>
      ) : (
        <div className="grid" style={{ gap: 0 }}>
          {rows.map((r) => {
            const reason = str(r.after?.reason) ?? str(r.after?.note);
            const extra = details(r);
            const target = targetLabel(r);
            const href = targetHref(r);
            const entity = `${r.entityType}:${r.entityId}`;
            return (
              <div key={r.id} className="row" style={{ gap: 12, fontSize: 14, padding: '10px 0', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span className="faint" style={{ width: 120, flex: 'none' }} title={new Date(r.createdAt).toLocaleString('ru-RU')}>
                  {stamp(r.createdAt)}
                </span>
                {r.actorId && f.actor !== r.actorId ? (
                  <a style={{ fontWeight: 600 }} {...filterLink({ actor: r.actorId }, { actor: r.actor ?? undefined })} title="Все действия сотрудника">
                    {r.actor ?? r.actorId.slice(0, 8)}
                  </a>
                ) : (
                  <span style={{ fontWeight: 600 }}>{r.actor ?? (r.actorId ? r.actorId.slice(0, 8) : 'система')}</span>
                )}
                <span>
                  {ACTION[r.action] ?? r.action}
                  {extra.length ? <span className="muted"> · {extra.join(' · ')}</span> : null}
                </span>
                <span className="faint">
                  {f.entity !== entity ? (
                    <a {...filterLink({ entity }, { entity: target })} title="Вся история">{target}</a>
                  ) : (
                    target
                  )}
                  {href && (
                    <>
                      {' '}
                      <Link href={href} aria-label={`Открыть: ${target}`} title="Открыть">↗</Link>
                    </>
                  )}
                </span>
                {reason && <span className="muted">— {reason}</span>}
              </div>
            );
          })}
        </div>
      )}
      {!!rows?.length && (
        <div className="row" style={{ gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {next && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void more()}>
              {busy ? '…' : 'Показать ещё'}
            </button>
          )}
          <span className="faint" style={{ fontSize: 13 }}>
            Показано {rows.length}
            {next ? '' : ' — это все записи'}
          </span>
        </div>
      )}
    </section>
  );
}
