'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Живость витрины (18.11.2026, «оживляй»): блоки с классом reveal мягко появляются при прокрутке,
 * обложка лота чуть наклоняется за курсором. Один слушатель на страницу; без движения — ничего не делает.
 */
export function LiveFx() {
  const path = usePathname();
  // Шапка стеклянная: пока страница наверху — прозрачная, после прокрутки под ней матовая полоса,
  // чтобы баннер и значки не просвечивали над плитой шапки
  useEffect(() => {
    const root = document.documentElement;
    const sync = () => root.classList.toggle('is-scrolled', window.scrollY > 8);
    sync();
    window.addEventListener('scroll', sync, { passive: true });
    return () => window.removeEventListener('scroll', sync);
  }, []);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.querySelectorAll('.reveal').forEach((el) => el.classList.add('is-in'));
      return;
    }
    const io = new IntersectionObserver(
      (es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add('is-in'), io.unobserve(e.target))),
      { rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('.reveal:not(.is-in)').forEach((el) => io.observe(el));
    const move = (ev: PointerEvent) => {
      const c = (ev.target as Element | null)?.closest?.('.lc__cover') as HTMLElement | null;
      if (!c || ev.pointerType !== 'mouse') return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--ry', `${((ev.clientX - r.left) / r.width - 0.5) * 10}deg`);
      c.style.setProperty('--rx', `${-((ev.clientY - r.top) / r.height - 0.5) * 8}deg`);
    };
    const out = (ev: PointerEvent) => {
      const c = (ev.target as Element | null)?.closest?.('.lc__cover') as HTMLElement | null;
      if (c && !c.contains(ev.relatedTarget as Node)) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }
    };
    document.addEventListener('pointermove', move, { passive: true });
    document.addEventListener('pointerout', out, { passive: true });
    return () => {
      io.disconnect();
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
    };
  }, [path]);
  return null;
}
