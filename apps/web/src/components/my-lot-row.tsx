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
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dayMonth = (iso: string) => new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

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
    if (!window.confirm(`Удалить «${lot.title}»? Если по лоту были заказы, он уйдёт в архив — история сделок сохранится.`)) {
      return;
    }
    void run(() => apiFetch(`/listings/${lot.id}`, { method: 'DELETE' }), 'Не удалось удалить лот.');
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
        aria-label={`Выбрать «${lot.title}»`}
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
          {soldOut && <span className="badge">закончился</span>}
          {blocked && <span className="badge danger">заблокирован модератором</span>}
          {lot.status === 'paused' && lot.pausedForAway && <span className="badge">снят на время отпуска</span>}
          {counted && !soldOut && <span>в наличии {formatQty(lot.stock!, lot.unitName)}</span>}
          {active && later(lot.boostUntil) && <span>в топе до {hhmm(lot.boostUntil!)}</span>}
          {active && later(lot.promotedUntil) && <span>продвижение до {dayMonth(lot.promotedUntil!)}</span>}
        </div>
      </div>

      <PriceCell lot={lot} disabled={busy || blocked} onSave={(price) => patch({ price }, 'Цена не сохранилась.')} />

      <div className="my-lot-state">
        {blocked ? (
          <Link href="/cabinet/support" className="my-lot-link">
            В поддержку
          </Link>
        ) : soldOut ? (
          // Распроданный лот возвращается в продажу пополнением, а не
          // переключателем: без наличия его всё равно нельзя купить.
          <Link href={lot.fulfillmentType === 'auto_key' ? `/lot/${lot.id}#keys` : `/cabinet/lot/${lot.id}`} className="my-lot-link">
            {lot.fulfillmentType === 'auto_key' ? 'Пополнить склад' : 'Пополнить'}
          </Link>
        ) : (
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={active}
            aria-label={`«${lot.title}» в продаже`}
            disabled={busy}
            onClick={() => void patch({ status: active ? 'paused' : 'active' }, 'Не удалось изменить статус лота.')}
          >
            <span className="switch-track" aria-hidden>
              <span className="switch-thumb" />
            </span>
            <span className="switch-label" aria-hidden>
              В продаже
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
            aria-label={later(lot.promotedUntil) ? 'Продлить продвижение' : 'Продвинуть'}
            title={later(lot.promotedUntil) ? 'Продлить продвижение' : 'Продвинуть'}
            onClick={() => setPromoting((p) => !p)}
          >
            <TrendingUp size={17} strokeWidth={1.75} />
          </button>
        )}
        {!blocked && (
          <Link href={`/cabinet/lot/${lot.id}`} className="icon-btn" aria-label={`Изменить «${lot.title}»`} title="Изменить">
            <Pencil size={16} strokeWidth={1.75} />
          </Link>
        )}
        {!blocked && (
          <button
            type="button"
            className="icon-btn"
            disabled={busy}
            onClick={remove}
            aria-label={`Удалить «${lot.title}»`}
            title="Удалить"
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
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  // Enter, а следом потеря фокуса не должны сохранять дважды, а Esc — сохранять вовсе.
  const settled = useRef(false);
  const pack = perPackLabel(lot);

  if (lot.topupMarkupBps != null) {
    return (
      <div className="my-lot-price" title="Цена следует из наценки — меняется в форме лота">
        <span className="my-lot-amount">{formatListingPrice(lot)}</span>
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
          aria-label={`Цена ${formatPrice(lot.price, lot.currency)}${pack ? ` ${pack}` : ''} — изменить`}
          onClick={() => {
            settled.current = false;
            setBad(false);
            setDraft(minorToInput(lot.price));
          }}
        >
          {formatPrice(lot.price, lot.currency)}
          <Pencil size={13} strokeWidth={1.75} aria-hidden />
        </button>
      ) : (
        <span className="price-input">
          <input
            className="input"
            autoFocus
            inputMode="decimal"
            value={draft}
            aria-label={`Новая цена${pack ? ` ${pack}` : ''}`}
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
          Цена — число больше нуля
        </span>
      ) : (
        pack && <span className="my-lot-pack">{pack}</span>
      )}
    </div>
  );
}
