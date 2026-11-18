'use client';

import { useEffect, useRef, useState } from 'react';

/** Число считается от нуля, когда появляется на экране (как полоса цифр у SteamBuy). Без движения — сразу итог. */
export function CountUp({ to, locale = 'ru-RU' }: { to: number; locale?: string }) {
  const [v, setV] = useState(to);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setV(0);
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 1100);
        setV(Math.round(to * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [to]);
  return <span ref={ref}>{v.toLocaleString(locale)}</span>;
}
