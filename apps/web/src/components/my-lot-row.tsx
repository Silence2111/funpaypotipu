'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Pencil, Trash2, TrendingUp } from 'lucide-react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import {
  currencySymbol,
  formatListingPrice,
  formatPrice,
  formatQty,
  minorToInput,
  parseMoneyInput,
  perPackLabel,
} from '@/lib/format';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';
import { BumpButton } from './bump-button';
import { PromotePanel } from './promote-panel';

/** Свой лот — строка ответа `GET /listings/mine`. */
export interface MyLot {
  id: string;
  title: string;
  price: string;
  currency: string;
  status: string;
  /** Снят на время отпуска — вернётся в продажу вместе с остальными. */
  pausedForAway?: boolean;
  boostUntil?: string | null;
  promotedUntil?: string | null;
  topupMarkupBps?: number | null;
  fulfillmentType?: string;
  unitName?: string | null;
  pricePerUnits?: number;
  stock?: number | null;
  categoryId: string;
  category: { slug: string; title: string };
  game: { slug: string; title: string };
}

const later = (iso?: string | null) => !!iso && new Date(iso).getTime() > Date.now();
const hhmm = (iso: string, t: T) => new Date(iso).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' });
const dayMonth = (iso: string, t: T) => new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' });

/**
 * Строка «Моих лотов», как в «Моих предложениях» FunPay: галочка для
 * действий над несколькими лотами, цена правится по клику, переключатель
 * «В продаже», поднять, продвинуть, изменить, удалить.
 */
export function MyLotRow({
  lot,
  selected,
  onSelect,
  onChanged,
  onError,
}: {
  lot: MyLot;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [promoting, setPromoting] = useState(false);

  async function run(fn: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      onChanged();
      return true;
    } catch (e) {
      onError(apiErrorMessage(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const patch = (body: object, fallback: string) =>
    run(() => apiFetch(`/listings/${lot.id}`, { method: 'PATCH', body: JSON.stringify(body) }), fallback);

  function remove() {
    if (
      !window.confirm(
        t('Удалить «{title}»? Если по лоту были заказы, он уйдёт в архив — история сделок сохранится.', {
          title: lot.title,
        }),
      )
    ) {
      return;
    }
    void run(() => apiFetch(`/listings/${lot.id}`, { method: 'DELETE' }), t('Не удалось удалить лот.'));
  }

  const active = lot.status === 'active';
  const blocked = lot.status === 'blocked';
  const soldOut = lot.status === 'sold_out';
  const counted = lot.stock != null && (!!lot.unitName || lot.fulfillmentType === 'auto_key');

  return (
    <div className="my-lot" data-status={lot.status} data-selected={selected ? 'true' : undefined}>
      <input
        type="checkbox"
        className="my-lot-check"
        checked={selected}
        onChange={(e) => onSelect(e.target.checked)}
        aria-label={t('Выбрать «{title}»', { title: lot.title })}
      />

      <div className="my-lot-main">
        {active || soldOut ? (
          <Link href={`/lot/${lot.id}`} className="my-lot-title">
            {lot.title}
          </Link>
        ) : (
          <span className="my-lot-title">{lot.title}</span>
        )}
        <div className="my-lot-meta">
          {soldOut && <span className="badge">{t('закончился')}</span>}
          {blocked && <span className="badge danger">{t('заблокирован модератором')}</span>}
          {lot.status === 'paused' && lot.pausedForAway && <span className="badge">{t('снят на время отпуска')}</span>}
          {counted && !soldOut && <span>{t('в наличии {qty}', { qty: formatQty(lot.stock!, lot.unitName, t) })}</span>}
          {active && later(lot.boostUntil) && <span>{t('в топе до {time}', { time: hhmm(lot.boostUntil!, t) })}</span>}
          {active && later(lot.promotedUntil) && (
            <span>{t('продвижение до {date}', { date: dayMonth(lot.promotedUntil!, t) })}</span>
          )}
        </div>
      </div>

      <PriceCell lot={lot} disabled={busy || blocked} onSave={(price) => patch({ price }, t('Цена не сохранилась.'))} />

      <div className="my-lot-state">
        {blocked ? (
          <Link href="/cabinet/support" className="my-lot-link">
            {t('В поддержку')}
          </Link>
        ) : soldOut ? (
          // Распроданный лот возвращается в продажу пополнением, а не
          // переключателем: без наличия его всё равно нельзя купить.
          <Link href={lot.fulfillmentType === 'auto_key' ? `/lot/${lot.id}#keys` : `/cabinet/lot/${lot.id}`} className="my-lot-link">
            {lot.fulfillmentType === 'auto_key' ? t('Пополнить склад') : t('Пополнить')}
          </Link>
        ) : (
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={active}
            aria-label={t('«{title}» в продаже', { title: lot.title })}
            disabled={busy}
            onClick={() => void patch({ status: active ? 'paused' : 'active' }, t('Не удалось изменить статус лота.'))}
          >
            <span className="switch-track" aria-hidden>
              <span className="switch-thumb" />
            </span>
            <span className="switch-label" aria-hidden>
              {t('В продаже')}
            </span>
          </button>
        )}
      </div>

      <div className="my-lot-actions">
        {active && <BumpButton key={lot.boostUntil ?? lot.id} listingId={lot.id} boostUntil={lot.boostUntil} />}
        {active && (
          <button
            type="button"
            className="icon-btn"
            aria-expanded={promoting}
            aria-label={later(lot.promotedUntil) ? t('Продлить продвижение') : t('Продвинуть')}
            title={later(lot.promotedUntil) ? t('Продлить продвижение') : t('Продвинуть')}
            onClick={() => setPromoting((p) => !p)}
          >
            <TrendingUp size={17} strokeWidth={1.75} />
          </button>
        )}
        {!blocked && (
          <Link
            href={`/cabinet/lot/${lot.id}`}
            className="icon-btn"
            aria-label={t('Изменить «{title}»', { title: lot.title })}
            title={t('Изменить')}
          >
            <Pencil size={16} strokeWidth={1.75} />
          </Link>
        )}
        {!blocked && (
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={remove}
            aria-label={t('Удалить «{title}»', { title: lot.title })}
            title={t('Удалить')}
          >
            <Trash2 size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {promoting && (
        <div className="my-lot-panel">
          <PromotePanel
            listingId={lot.id}
            promotedUntil={lot.promotedUntil}
            onDone={onChanged}
            onClose={() => setPromoting(false)}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Цена с правкой по клику: Enter или уход из поля — сохранить, Esc — отмена.
 * У лота «на сумму покупателя» цена следует из наценки и правится в форме.
 */
function PriceCell({
  lot,
  disabled,
  onSave,
}: {
  lot: MyLot;
  disabled: boolean;
  onSave: (price: string) => Promise<boolean>;
}) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  // Enter, а следом потеря фокуса не должны сохранять дважды, а Esc — сохранять вовсе.
  const settled = useRef(false);
  const pack = perPackLabel(lot, t);

  if (lot.topupMarkupBps != null) {
    return (
      <div className="my-lot-price" title={t('Цена следует из наценки — меняется в форме лота')}>
        <span className="my-lot-amount">{formatListingPrice(lot, t)}</span>
      </div>
    );
  }

  async function commit() {
    if (settled.current || draft === null) return;
    const minor = parseMoneyInput(draft);
    if (minor === null) {
      setBad(true);
      return;
    }
    settled.current = true;
    if (minor.toString() === lot.price || (await onSave(minor.toString()))) setDraft(null);
    else settled.current = false;
  }

  return (
    <div className="my-lot-price">
      {draft === null ? (
        <button
          type="button"
          className="price-edit"
          disabled={disabled}
          aria-label={t('Цена {price} — изменить', {
            price: `${formatPrice(lot.price, lot.currency, t)}${pack ? ` ${pack}` : ''}`,
          })}
          onClick={() => {
            settled.current = false;
            setBad(false);
            setDraft(minorToInput(lot.price));
          }}
        >
          {formatPrice(lot.price, lot.currency, t)}
          <Pencil size={13} strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
        <span className="price-input">
          <input
            className="input"
            autoFocus
            inputMode="decimal"
            value={draft}
            aria-label={pack ? t('Новая цена {pack}', { pack }) : t('Новая цена')}
            aria-invalid={bad || undefined}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commit();
              } else if (e.key === 'Escape') {
                settled.current = true;
                setBad(false);
                setDraft(null);
              }
            }}
            onBlur={() => void commit()}
          />
          <span aria-hidden>{currencySymbol(lot.currency)}</span>
        </span>
      )}
      {draft !== null && bad ? (
        <span className="my-lot-pack field-error" role="alert">
          {t('Цена — число больше нуля')}
        </span>
      ) : (
        pack && <span className="my-lot-pack">{pack}</span>
      )}
    </div>
  );
}
