'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n/client';

export type PromoSlide = {
  key: string;
  kicker: string;
  title: string;
  sub: string;
  href: string;
  cta: string;
  /** Цвет плиты — фирменный цвет марки. */
  color: string;
  /** Знак марки (маска) — бледно на фоне справа. */
  mark?: string;
  /** Объёмный предмет (свой рендер) — крупно справа, как арт на баннерах Playerok. */
  art?: string;
  /** Настоящие лоты раздела: число крупно и цена, как обложки в ленте. */
  lots?: Array<{ id: string; big: string; unit: string; price: string; color: string }>;
};

/**
 * Баннеры первого экрана, как карусель Playerok: большая скруглённая плита, полоски-индикаторы
 * снизу, листается сама раз в 6 секунд и стоит, пока на ней курсор. Вместо ключевых артов игр
 * (у нас без персонажей) — цвет марки, её знак и настоящие лоты раздела с ценой.
 */
export function PromoBanners({ slides }: { slides: PromoSlide[] }) {
  const t = useT();
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);
  const startX = useRef<number | null>(null);
  const n = slides.length;
  useEffect(() => {
    if (hold || n < 2) return;
    const id = setTimeout(() => setI((x) => (x + 1) % n), 6000);
    return () => clearTimeout(id);
  }, [i, hold, n]);
  if (!n) return null;
  const go = (d: number) => setI((x) => (x + d + n) % n);
  return (
    <section
      className="pb"
      aria-roledescription="carousel"
      aria-label={t('Предложения')}
      onMouseEnter={() => setHold(true)}
      onMouseLeave={(e) => {
        setHold(false);
        e.currentTarget.style.removeProperty('--mx');
        e.currentTarget.style.removeProperty('--my');
      }}
      onMouseMove={(e) => {
        // лёгкий параллакс предметов за курсором
        const r = e.currentTarget.getBoundingClientRect();
        e.currentTarget.style.setProperty('--mx', String(((e.clientX - r.left) / r.width - 0.5) * 2));
        e.currentTarget.style.setProperty('--my', String(((e.clientY - r.top) / r.height - 0.5) * 2));
      }}
      onPointerDown={(e) => (startX.current = e.clientX)}
      onPointerUp={(e) => {
        if (startX.current === null) return;
        const dx = e.clientX - startX.current;
        startX.current = null;
        if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
      }}
    >
      <div className="pb__track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, k) => (
          <div
            key={s.key}
            className="pb__slide"
            style={{ ['--c' as string]: s.color }}
            aria-hidden={k !== i}
            role="group"
            aria-roledescription="slide"
          >
            <div className="pb__text">
              <span className="pb__kicker">{s.kicker}</span>
              <h2 className="pb__title">{s.title}</h2>
              <p className="pb__sub">{s.sub}</p>
              <Link href={s.href} className="pb__cta" tabIndex={k === i ? 0 : -1}>
                {s.cta}
              </Link>
            </div>
            <div className="pb__art" aria-hidden>
              {s.mark && <span className="pb__mark" style={{ WebkitMaskImage: `url(${s.mark})`, maskImage: `url(${s.mark})` }} />}
              {s.art && (
                // eslint-disable-next-line @next/next/no-img-element -- свой рендер из public
                <img className={s.lots?.length ? 'pb__obj pb__obj--side' : 'pb__obj'} src={s.art} alt="" />
              )}
              {s.lots && s.lots.length > 0 && (
                <span className="pb__lots">
                  {s.lots.map((l) => (
                    <span key={l.id} className="pb__lot" style={{ ['--c' as string]: l.color }}>
                      <span className="pb__lotc">
                        <b>{l.big}</b>
                        <span>{l.unit}</span>
                      </span>
                      <span className="pb__lotp">{l.price}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button type="button" className="pb__nav pb__nav--l" onClick={() => go(-1)} aria-label={t('Назад')}>
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
          <button type="button" className="pb__nav pb__nav--r" onClick={() => go(1)} aria-label={t('Вперёд')}>
            <ChevronRight size={20} strokeWidth={2} />
          </button>
          <div className="pb__dots">
            {slides.map((s, k) => (
              <button
                key={s.key}
                type="button"
                className={k === i ? 'on' : ''}
                onClick={() => setI(k)}
                aria-label={t('Слайд {n}', { n: k + 1 })}
                aria-current={k === i}
              >
                <i style={k === i && !hold ? { animationDuration: '6s' } : undefined} />
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
