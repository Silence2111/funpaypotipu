'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * Выпадающий список, который меняет один параметр адреса: игра в поиске по
 * предложениям. Остальные параметры остаются, страница — снова первая;
 * `reset` убирает зависимые параметры (раздел другой игры).
 */
export function ParamSelect({
  name,
  label,
  value,
  options,
  reset = [],
}: {
  name: string;
  label: string;
  value?: string;
  options: Array<[string, string]>;
  reset?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  return (
    <select
      className="input filter-select"
      aria-label={label}
      data-active={value ? 'true' : undefined}
      value={value ?? ''}
      onChange={(e) => {
        const p = new URLSearchParams(sp.toString());
        for (const k of [name, 'page', ...reset]) p.delete(k);
        if (e.target.value) p.set(name, e.target.value);
        const s = p.toString();
        router.push(s ? `${pathname}?${s}` : pathname);
      }}
    >
      <option value="">{label}</option>
      {options.map(([v, t]) => (
        <option key={v} value={v}>
          {t}
        </option>
      ))}
    </select>
  );
}
