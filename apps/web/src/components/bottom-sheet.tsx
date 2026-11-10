'use client';

import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';

/**
 * Шторка снизу на телефоне: профиль, фильтры раздела. Закрывается жестом
 * вниз, нажатием мимо и Esc; пока открыта, страница под ней не листается.
 * Нажатие на ссылку внутри закрывает шторку: ссылка на текущую страницу не
 * меняет адрес, и шторка иначе осталась бы висеть.
 */
export function BottomSheet({
  label,
  onClose,
  children,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [drag, setDrag] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const onTouchStart = (e: TouchEvent) => {
    // Тянуть можно, только когда шторка не прокручена вниз.
    startY.current = (panel.current?.scrollTop ?? 0) > 0 ? null : e.touches[0]!.clientY;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (startY.current !== null) setDrag(Math.max(0, e.touches[0]!.clientY - startY.current));
  };
  const onTouchEnd = () => {
    if (drag > 80) onClose();
    startY.current = null;
    setDrag(0);
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panel}
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if ((e.target as HTMLElement).closest('a')) onClose();
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="sheet-grip" aria-hidden />
        {children}
      </div>
    </div>
  );
}
