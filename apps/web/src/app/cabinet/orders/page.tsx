'use client';

import { Suspense, useEffect, useRef, useState, type MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { isCurrentQuery, isPlainClick, replaceUrl, withQuery } from '@/lib/url';
import { formatPrice, formatQty } from '@/lib/format';
import { CabinetNav } from '@/components/cabinet-nav';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';

interface Row {
  id: string;
  publicNumber: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  title: string | null;
  qty: number;
  /** Единица поштучного заказа; null — товар целиком. */
  unitName: string | null;
  counterparty: string | null;
  role: 'buyer' | 'seller';
}

interface Page {
  items: Row[];
  /** С какого заказа продолжать «Показать ещё»; null — показаны все. */
  next: string | null;
}

const STATUS: Record<string, string> = {
  created: msg('ждёт оплаты'),
  paid: msg('оплачен'),
  delivered: msg('выдан'),
  completed: msg('завершён'),
  disputed: msg('спор'),
  refunded: msg('возврат'),
  cancelled: msg('отменён'),
  expired: msg('истёк'),
};

/** Фильтры как на FunPay: по смыслу для человека, а не по каждому статусу базы. */
const FILTERS: Array<{ key: string; label: string; status: string[] }> = [
  { key: 'all', label: msg('Все'), status: [] },
  { key: 'work', label: msg('В работе'), status: ['paid', 'delivered'] },
  { key: 'dispute', label: msg('Споры'), status: ['disputed'] },
  { key: 'done', label: msg('Завершены'), status: ['completed'] },
  { key: 'closed', label: msg('Возвраты и отмены'), status: ['refunded', 'cancelled', 'expired'] },
  { key: 'unpaid', label: msg('Ждут оплаты'), status: ['created'] },
];

/** Период — последние N дней; пусто — за всё время. */
const PERIODS: Array<{ days: string; label: string }> = [
  { days: '', label: msg('За всё время') },
  { days: '7', label: msg('7 дней') },
  { days: '30', label: msg('30 дней') },
  { days: '90', label: msg('3 месяца') },
  { days: '365', label: msg('Год') },
];

/** Какой список открыт: всё это — в адресе страницы. */
interface View {
  role: 'buyer' | 'seller';
  f: string;
  q: string;
  days: string;
}

const viewOf = (p: { get(name: string): string | null }): View => ({
  role: p.get('role') === 'seller' ? 'seller' : 'buyer',
  f: FILTERS.find((f) => f.key === p.get('f'))?.key ?? 'all',
  q: p.get('q') ?? '',
  days: PERIODS.some((d) => d.days === p.get('days')) ? p.get('days')! : '',
});

const keyOf = (v: View) => `${v.role}|${v.f}|${v.q}|${v.days}`;

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <Orders />
    </Suspense>
  );
}

/**
 * Покупки и продажи: фильтр по смыслу, поиск по номеру заказа, лоту и нику
 * другой стороны, период; по 30 и «Показать ещё». Всё — в адресе страницы,
 * чтобы ссылкой можно было вернуться к тому же списку. Выбор страница держит
 * у себя и сама переписывает адрес: период сразу после фильтра не сбрасывает
 * фильтр, даже если адрес ещё не догнал.
 */
function Orders() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(() => viewOf(params));
  const { role, q, days } = view;
  const filter = FILTERS.find((f) => f.key === view.f) ?? FILTERS[0]!;
  // Поле поиска меняется сразу, адрес и список — после паузы в наборе.
  const [text, setText] = useState(q);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [toShip, setToShip] = useState(0);
  const key = keyOf(view);
  // «Показать ещё» дописывает только к тому списку, с которого начинал.
  const current = useRef(key);

  const query = (before?: string) => {
    const qs = new URLSearchParams({ role });
    if (filter.status.length) qs.set('status', filter.status.join(','));
    if (q) qs.set('q', q);
    if (days) qs.set('days', days);
    if (before) qs.set('before', before);
    return `/orders/history?${qs}`;
  };

  useEffect(() => {
    current.current = key;
    if (!getToken()) {
      router.replace('/login?next=/cabinet/orders');
      return;
    }
    let stop = false;
    setRows(null);
    setNext(null);
    setErr(null);
    apiFetch<Page>(query())
      .then((p) => {
        if (stop) return;
        setRows(p.items);
        setNext(p.next);
      })
      .catch((e) => {
        if (stop) return;
        setRows([]);
        setErr(apiErrorMessage(e, t('Не удалось загрузить заказы.')));
      });
    return () => {
      stop = true;
    };
    // query() собирается из того же, что и key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, key, t]);

  // Сколько продаж ждут выдачи — видно на вкладке, как счётчик на FunPay.
  useEffect(() => {
    if (!getToken()) return;
    apiFetch<Row[]>('/orders/mine?role=seller&status=paid')
      .then((r) => setToShip(r.length))
      .catch(() => {});
  }, []);

  // Переход по ссылке, пока страница открыта, — «Продажи» и «Покупки» в меню
  // шапки: выбор берём из адреса. Свой же адрес совпадёт с выбором и ничего
  // не изменит.
  useEffect(() => {
    if (!isCurrentQuery(params)) return;
    const v = viewOf(params);
    if (keyOf(v) === key) return;
    setView(v);
    setText(v.q);
    // Только переходы по адресу: свой выбор сюда не возвращается.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /** Адрес списка: роль и фильтр — ссылками, поиск и период переносятся. */
  const href = (over: Partial<View>) => {
    const v = { ...view, ...over };
    return withQuery(pathname, { role: v.role, f: v.f !== 'all' && v.f, q: v.q, days: v.days });
  };

  function go(over: Partial<View>) {
    setView({ ...view, ...over });
    replaceUrl(href(over));
  }

  /** Ссылка-фильтр: обычный клик меняет список на месте, с Ctrl — новая вкладка. */
  const pick = (over: Partial<View>) => (e: MouseEvent) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    go(over);
  };

  useEffect(() => {
    const want = text.trim();
    if (want === q) return;
    const timer = setTimeout(() => go({ q: want }), 350);
    return () => clearTimeout(timer);
    // go собирает адрес из того же выбора, что и key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, key]);

  async function more() {
    if (!next) return;
    const start = key;
    setBusy(true);
    try {
      const p = await apiFetch<Page>(query(next));
      if (current.current !== start) return;
      setRows((prev) => [...(prev ?? []), ...p.items]);
      setNext(p.next);
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось загрузить заказы.')));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setText('');
    go({ q: '', days: '' });
  }

  const searching = !!(q || days);

  return (
    <div className="container stack-lg" style={{ paddingTop: 40 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Заказы')}</h1>
        <div style={{ marginTop: 16 }}>
          <CabinetNav />
        </div>
      </div>

      <div className="stack-form" style={{ gap: 12 }}>
        <div className="row" role="tablist" aria-label={t('Покупки или продажи')} style={{ gap: 8 }}>
          <Link href={href({ role: 'buyer' })} onClick={pick({ role: 'buyer' })} prefetch={false}
            className="chip" role="tab" aria-selected={role === 'buyer'}
            aria-current={role === 'buyer' ? 'page' : undefined}>
            {t('Покупки')}
          </Link>
          <Link href={href({ role: 'seller' })} onClick={pick({ role: 'seller' })} prefetch={false}
            className="chip" role="tab" aria-selected={role === 'seller'}
            aria-current={role === 'seller' ? 'page' : undefined}>
            {t('Продажи')}
            {toShip > 0 ? ` · ${t('{n} ждут выдачи', { n: toShip })}` : ''}
          </Link>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }} aria-label={t('Статус')}>
          {FILTERS.map((f) => (
            <Link key={f.key} href={href({ f: f.key })} onClick={pick({ f: f.key })} prefetch={false} className="chip"
              style={{ fontSize: 13, minHeight: 36 }}
              aria-current={f.key === filter.key ? 'page' : undefined}>
              {t(f.label)}
            </Link>
          ))}
        </div>
        <div className="row orders-search-row">
          <label className="orders-search">
            <Search size={16} strokeWidth={1.75} aria-hidden />
            <input type="search" className="input" value={text} onChange={(e) => setText(e.target.value)}
              placeholder={t('Номер заказа, лот или ник')} aria-label={t('Поиск по заказам')}
              autoComplete="off" spellCheck={false} maxLength={100} />
          </label>
          <select className="input orders-period" aria-label={t('Период')} value={days}
            onChange={(e) => go({ days: e.target.value })}>
            {PERIODS.map((p) => (
              <option key={p.days || 'all'} value={p.days}>{t(p.label)}</option>
            ))}
          </select>
        </div>
      </div>

      {err && (
        <div className="alert error" role="alert">
          {err}
        </div>
      )}

      {rows === null ? (
        <div aria-busy="true" aria-label={t('Загружаем заказы')}>
          <div className="skeleton" style={{ height: 72 }} />
          <div className="skeleton" style={{ height: 72, marginTop: 8 }} />
        </div>
      ) : rows.length === 0 && searching ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">{t('Ничего не нашлось. Проверьте номер заказа, название лота или ник.')}</span>
          <button type="button" className="btn secondary" onClick={reset}>{t('Сбросить поиск')}</button>
        </div>
      ) : rows.length === 0 ? (
        <div className="card flat row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <span className="muted">
            {filter.key === 'all'
              ? role === 'buyer'
                ? t('Покупок пока нет. Деньги будут у площадки, пока вы не подтвердите получение.')
                : t('Продаж пока нет. Лот с понятным описанием и честной ценой продаётся быстрее.')
              : t('Заказов с таким статусом нет.')}
          </span>
          {filter.key === 'all' && (
            <Link href={role === 'buyer' ? '/catalog' : '/cabinet/new'} className="btn secondary">
              {role === 'buyer' ? t('В каталог') : t('Продать лот')}
            </Link>
          )}
        </div>
      ) : (
        // Таблицей, как «Покупки» и «Продажи» на FunPay: заказ, кто на той
        // стороне, статус, сумма — строки одной высоты читаются быстрее карточек.
        <div className="offers" style={{ ['--offer-cols' as string]: 'minmax(0, 1fr) minmax(120px, 180px) minmax(120px, 150px) minmax(96px, 120px)' }}>
          <div className="offer-head" aria-hidden>
            <span>{t('Заказ')}</span>
            <span>{role === 'buyer' ? t('Продавец') : t('Покупатель')}</span>
            <span>{t('Статус')}</span>
            <span className="num">{t('Сумма')}</span>
          </div>
          {rows.map((o) => {
            const ship = o.status === 'paid' && o.role === 'seller';
            const confirm = o.status === 'delivered' && o.role === 'buyer';
            return (
              <Link key={o.id} href={`/orders/${o.id}`} className="offer-row order-row">
                <span className="offer-desc">
                  <span className="offer-title">{o.title ?? o.publicNumber}</span>
                  <span className="offer-meta">
                    <span>
                      {o.unitName && (o.qty > 1 || o.unitName !== 'шт.') ? `${formatQty(o.qty, o.unitName, t)} · ` : ''} {/* i18n-ignore */}
                      {o.publicNumber} ·{' '}
                      {new Date(o.createdAt).toLocaleDateString(t.locale, { day: 'numeric', month: 'short' })}
                    </span>
                    {o.counterparty && (
                      <span className="only-mobile">
                        {o.role === 'buyer'
                          ? t('продавец {name}', { name: o.counterparty })
                          : t('покупатель {name}', { name: o.counterparty })}
                      </span>
                    )}
                  </span>
                </span>
                <span className="offer-attr">{o.counterparty ?? <span className="faint">—</span>}</span>
                <span className="order-status">
                  <span
                    className={
                      o.status === 'completed'
                        ? 'badge success'
                        : o.status === 'disputed'
                          ? 'badge warning'
                          : ship || confirm
                            ? 'badge accent'
                            : 'badge'
                    }
                  >
                    {ship
                      ? t('нужно выдать')
                      : confirm
                        ? t('подтвердите получение')
                        : STATUS[o.status]
                          ? t(STATUS[o.status]!)
                          : o.status}
                  </span>
                </span>
                <span className="offer-price num">
                  <span className="price">{formatPrice(o.amount, o.currency, t)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      )}
      {next && (
        <button type="button" className="btn secondary" disabled={busy} onClick={() => void more()}
          style={{ alignSelf: 'center' }}>
          {busy ? '…' : t('Показать ещё')}
        </button>
      )}
    </div>
  );
}
