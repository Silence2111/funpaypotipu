'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { RULE_GROUPS } from '@gamemarket/shared/rules';

export interface Decision {
  reason: string;
  rule?: string;
}

interface Ask {
  title: string;
  /** Что увидит человек: «её увидит продавец» и т. п. */
  hint?: string;
  reason?: string;
  /** Пункт правил обязателен у решений против человека (часть 134). */
  withRule?: boolean;
  /** Поле суммы — для удержания. */
  withAmount?: boolean;
  confirm?: string;
}

/**
 * Окно решения модератора (часть 134): пункт правил из списка и причина —
 * их увидит человек в «Решениях модерации» и сможет обжаловать. Раньше —
 * `window.prompt` только с причиной: «нарушение правил» без пункта.
 *
 * `const { dialog, ask } = useDecisionDialog()` — `dialog` один раз в
 * разметке раздела, `await ask({…})` — решение или null, если отменили.
 */
export function useDecisionDialog() {
  const [state, setState] = useState<(Ask & { resolve: (v: (Decision & { amount?: string }) | null) => void }) | null>(null);
  const [reason, setReason] = useState('');
  const [rule, setRule] = useState('');
  const [amount, setAmount] = useState('');
  const box = useRef<HTMLFormElement>(null);

  const ask = useCallback(
    (o: Ask) =>
      new Promise<(Decision & { amount?: string }) | null>((resolve) => {
        setReason(o.reason ?? '');
        setRule('');
        setAmount('');
        setState({ withRule: true, ...o, resolve });
      }),
    [],
  );

  const close = useCallback(
    (v: (Decision & { amount?: string }) | null) => {
      state?.resolve(v);
      setState(null);
    },
    [state],
  );

  useEffect(() => {
    if (!state) return;
    box.current?.querySelector<HTMLElement>('select, input, textarea')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, close]);

  const ok = reason.trim().length >= 3 && (!state?.withRule || !!rule) && (!state?.withAmount || Number(amount.replace(',', '.')) > 0);

  const dialog = state ? (
    <div className="sheet-backdrop" onClick={() => close(null)} style={{ display: 'grid', placeItems: 'center', padding: 16 }}>
      <form
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-title"
        className="card"
        style={{ width: 'min(520px, 100%)', padding: 20, display: 'grid', gap: 12 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!ok) return;
          close({ reason: reason.trim(), ...(rule ? { rule } : {}), ...(state.withAmount ? { amount: amount.replace(',', '.') } : {}) });
        }}
      >
        <h3 id="decision-title" style={{ margin: 0, fontSize: 17 }}>{state.title}</h3>
        {state.withAmount && (
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="decision-amount">Сумма, ₽</label>
            <input id="decision-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
        )}
        {state.withRule && (
          <div className="field" style={{ margin: 0 }}>
            <label className="label" htmlFor="decision-rule">Пункт правил</label>
            <select id="decision-rule" className="input" value={rule} onChange={(e) => setRule(e.target.value)}>
              <option value="">Выберите пункт</option>
              {RULE_GROUPS.map((g) => (
                <optgroup key={g.title} label={g.title}>
                  {g.clauses.map((c) => (
                    <option key={c.id} value={c.id}>{c.id} {c.title}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}
        <div className="field" style={{ margin: 0 }}>
          <label className="label" htmlFor="decision-reason">Причина своими словами</label>
          <textarea id="decision-reason" className="input" rows={3} maxLength={500} value={reason}
            onChange={(e) => setReason(e.target.value)} style={{ resize: 'vertical' }} />
          {state.hint && <span className="hint">{state.hint}</span>}
        </div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" className="btn ghost" onClick={() => close(null)}>Отмена</button>
          <button type="submit" className="btn" disabled={!ok}>{state.confirm ?? 'Подтвердить'}</button>
        </div>
      </form>
    </div>
  ) : null;

  return { dialog, ask };
}
