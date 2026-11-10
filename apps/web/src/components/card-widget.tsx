'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

/** Что отдаёт виджет ЮKassa: токен для выплаты и маска карты. Номера нет. */
export interface CardToken {
  token: string;
  first6: string;
  last4: string;
  type?: string;
  issuer?: string;
}

interface WidgetData {
  payout_token: string;
  first6: string;
  last4: string;
  card_type?: string;
  issuer_name?: string;
}

interface PayoutsDataWidget {
  render(containerId: string): Promise<unknown>;
  clearListeners?(): void;
}

declare global {
  interface Window {
    PayoutsData?: new (options: {
      type: 'payout';
      account_id: string;
      success_callback: (data: WidgetData) => void;
      error_callback: (error: unknown) => void;
    }) => PayoutsDataWidget;
  }
}

const scripts = new Map<string, Promise<void>>();

/** Скрипт виджета — один раз на страницу; не загрузился — можно попробовать снова. */
function loadScript(src: string): Promise<void> {
  let p = scripts.get(src);
  if (!p) {
    p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scripts.delete(src);
        s.remove();
        reject(new Error('widget'));
      };
      document.head.appendChild(s);
    });
    scripts.set(src, p);
  }
  return p;
}

/**
 * Карта для вывода — в форме ЮKassa. Номер уходит прямо в ЮKassa, площадке
 * она возвращает токен для выплаты и маску: номер карты у нас не хранится и
 * через наш сервер не идёт.
 */
export function CardWidget({
  accountId,
  scriptUrl,
  card,
  onCard,
}: {
  accountId: string;
  scriptUrl: string;
  card: CardToken | null;
  onCard: (card: CardToken | null) => void;
}) {
  const t = useT();
  const boxId = `yk-card-${useId().replace(/[^\w-]/g, '')}`;
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Свежий обработчик без перерисовки виджета.
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;
  const errorText = t('Карта не подошла. Проверьте номер или возьмите другую карту.');
  const errorRef = useRef(errorText);
  errorRef.current = errorText;

  useEffect(() => {
    if (card) return;
    let alive = true;
    let widget: PayoutsDataWidget | null = null;
    setState('loading');
    loadScript(scriptUrl)
      .then(() => {
        if (!alive) return;
        if (!window.PayoutsData) throw new Error('widget');
        widget = new window.PayoutsData({
          type: 'payout',
          account_id: accountId,
          success_callback: (d) => {
            setError(null);
            onCardRef.current({
              token: d.payout_token,
              first6: d.first6,
              last4: d.last4,
              type: d.card_type,
              issuer: d.issuer_name,
            });
          },
          error_callback: () => setError(errorRef.current),
        });
        return widget.render(boxId);
      })
      .then(() => alive && setState('ready'))
      .catch(() => alive && setState('failed'));
    return () => {
      alive = false;
      // Уходя со страницы — снять обработчики, как просит ЮKassa.
      widget?.clearListeners?.();
      const box = document.getElementById(boxId);
      if (box) box.innerHTML = '';
    };
  }, [accountId, scriptUrl, boxId, card, attempt]);

  if (card) {
    return (
      <div className="card-chosen">
        <CreditCard size={18} strokeWidth={1.75} aria-hidden />
        <span className="card-mask">
          {card.first6.slice(0, 4)} {card.first6.slice(4)}•• •••• {card.last4}
        </span>
        {card.issuer && <span className="faint">{card.issuer}</span>}
        <button className="chip" type="button" onClick={() => onCard(null)}>
          {t('Другая карта')}
        </button>
      </div>
    );
  }

  return (
    <div className="card-widget">
      <div id={boxId} aria-busy={state === 'loading'} />
      {state === 'loading' && <div className="skeleton" style={{ height: 44 }} />}
      {state === 'failed' && (
        <p className="hint">
          {t('Форма ЮKassa не загрузилась.')}{' '}
          <button className="link-button" type="button" onClick={() => setAttempt((a) => a + 1)}>
            {t('Попробовать снова')}
          </button>
        </p>
      )}
      {error && (
        <p className="hint" role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}
      <p className="hint">
        {t('Номер карты принимает ЮKassa — площадка его не видит и не хранит.')}
      </p>
    </div>
  );
}
