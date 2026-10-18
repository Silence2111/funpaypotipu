'use client';

import { useEffect, useState } from 'react';

/**
 * На телефоне — внизу цена и «Купить», когда форма покупки ушла вверх с
 * экрана: листаешь описание и отзывы, а купить можно не возвращаясь.
 * Кнопка возвращает к форме — там способ оплаты и данные для продавца.
 */
export function MobileBuyBar({
  target,
  price,
  note,
  label,
}: {
  /** Селектор формы покупки. */
  target: string;
  price: string;
  /** Подпись под ценой: «за 1 000 золота». */
  note?: string | null;
  label: string;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = document.querySelector(target);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShow(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [target]);

  if (!show) return null;
  return (
    <div className="buy-bar" role="region" aria-label="Покупка">
      <div className="buy-bar-price">
        <b>{price}</b>
        {note && <span>{note}</span>}
      </div>
      <button
        type="button"
        className="btn"
        onClick={() => document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        {label}
      </button>
    </div>
  );
}
