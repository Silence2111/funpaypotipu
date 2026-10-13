'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/format';
import { Empty } from './shared';

interface Rule {
  id: string;
  scope: 'global' | 'category' | 'seller_tier';
  scopeRef: string | null;
  scopeTitle: string | null;
  feeBuyerPct: number;
  feeSellerPct: number;
  currency: string;
  priority: number;
  active: boolean;
}
interface Game { id: string; slug: string; title: string }
interface Category { id: string; title: string }
interface Promo { code: string; type: 'percent' | 'fixed'; value: string | number; usedCount: number; maxUses: number | null }

const pct = (v: number) => `${String(Math.round(v * 1000) / 10).replace('.', ',')}%`;
const toShare = (v: string) => {
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 && n <= 50 ? n / 100 : null;
};

/**
 * Комиссии и промокоды — только администратор. Комиссия раздела перекрывает
 * общую: так у пополнений может быть своя ставка (ПЛАН.md, решение 5).
 */
export function FeesSection() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [games, setGames] = useState<Game[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [gameSlug, setGameSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newPct, setNewPct] = useState('');
  const [promos, setPromos] = useState<Promo[]>([]);
  const [code, setCode] = useState('');
  const [promoType, setPromoType] = useState<'percent' | 'fixed'>('fixed');
  const [promoValue, setPromoValue] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setRules(await apiFetch<Rule[]>('/admin/fee-rules').catch(() => []));
    setPromos(await apiFetch<Promo[]>('/promo').catch(() => []));
  }, []);

  useEffect(() => {
    void load();
    apiFetch<Game[]>('/catalog/games').then(setGames).catch(() => {});
  }, [load]);

  useEffect(() => {
    setCategoryId('');
    if (!gameSlug) return setCategories([]);
    apiFetch<{ categories: Category[] }>(`/catalog/games/${gameSlug}`)
      .then((g) => setCategories(g.categories))
      .catch(() => setCategories([]));
  }, [gameSlug]);

  async function run(fn: () => Promise<unknown>, ok: string, fail: string) {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fail) });
    }
  }

  function saveRule(r: Rule) {
    const share = toShare(edit[r.id] ?? '');
    if (share == null) return setMsg({ ok: false, text: 'Комиссия — число от 0 до 50, в процентах' });
    void run(
      () => apiFetch(`/admin/fee-rules/${r.id}`, { method: 'PATCH', body: JSON.stringify({ feeSellerPct: share }) }),
      'Комиссия сохранена. Новые заказы считаются по ней.',
      'Не удалось сохранить комиссию.',
    );
  }

  function createRule(e: FormEvent) {
    e.preventDefault();
    const share = toShare(newPct);
    if (!categoryId || share == null) return setMsg({ ok: false, text: 'Выберите раздел и укажите комиссию от 0 до 50%' });
    void run(
      () =>
        apiFetch('/admin/fee-rules', {
          method: 'POST',
          body: JSON.stringify({ scope: 'category', scopeRef: categoryId, feeBuyerPct: 0, feeSellerPct: share, currency: 'RUB', priority: 10 }),
        }),
      'Правило раздела создано.',
      'Не удалось создать правило.',
    );
  }

  function createPromo(e: FormEvent) {
    e.preventDefault();
    const n = parseFloat(promoValue.replace(',', '.'));
    if (code.trim().length < 3 || !(n > 0)) return setMsg({ ok: false, text: 'Код от 3 символов и размер скидки больше нуля' });
    const value = promoType === 'percent' ? Math.round(n) : Math.round(n * 100);
    void run(
      () => apiFetch('/promo', { method: 'POST', body: JSON.stringify({ code: code.trim(), type: promoType, value }) }),
      `Промокод ${code.trim().toUpperCase()} создан`,
      'Не удалось создать промокод.',
    );
    setCode('');
    setPromoValue('');
  }

  const scopeLabel = (r: Rule) =>
    r.scope === 'global' ? 'Общая' : r.scope === 'category' ? r.scopeTitle ?? 'Раздел' : `Уровень ${r.scopeRef ?? ''}`;

  return (
    <section className="stack-lg">
      {msg && (
        <div className={msg.ok ? 'alert success' : 'alert error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </div>
      )}
      <div>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 12 }}>Комиссия с продавца</h2>
        {rules === null ? (
          <div className="skeleton" style={{ height: 80 }} aria-busy="true" />
        ) : rules.length === 0 ? (
          <Empty>Правил нет — действует ставка по умолчанию.</Empty>
        ) : (
          <div className="grid" style={{ gap: 8 }}>
            {rules.map((r) => (
              <div key={r.id} className="card row" style={{ padding: 16, gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span style={{ minWidth: 180 }}>
                  <span style={{ fontWeight: 600 }}>{scopeLabel(r)}</span>
                  <span className="faint" style={{ display: 'block', fontSize: 13 }}>
                    сейчас {pct(r.feeSellerPct)}{r.feeBuyerPct ? ` · с покупателя ${pct(r.feeBuyerPct)}` : ''}
                    {r.active ? '' : ' · выключено'}
                  </span>
                </span>
                <span className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <input className="input" inputMode="decimal" style={{ width: 90 }} aria-label={`Комиссия, % — ${scopeLabel(r)}`}
                    placeholder={String(Math.round(r.feeSellerPct * 1000) / 10)} value={edit[r.id] ?? ''}
                    onChange={(e) => setEdit((s) => ({ ...s, [r.id]: e.target.value }))} />
                  <button type="button" className="chip" onClick={() => saveRule(r)}>Сохранить</button>
                  {r.scope !== 'global' && (
                    <button type="button" className="chip"
                      onClick={() => void run(
                        () => apiFetch(`/admin/fee-rules/${r.id}`, { method: 'PATCH', body: JSON.stringify({ active: !r.active }) }),
                        r.active ? 'Правило выключено.' : 'Правило включено.',
                        'Не удалось изменить правило.',
                      )}>
                      {r.active ? 'Выключить' : 'Включить'}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={createRule} className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <select className="input" style={{ maxWidth: 200 }} value={gameSlug} onChange={(e) => setGameSlug(e.target.value)} aria-label="Игра">
            <option value="">Игра</option>
            {games.map((g) => <option key={g.id} value={g.slug}>{g.title}</option>)}
          </select>
          <select className="input" style={{ maxWidth: 220 }} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
            disabled={!categories.length} aria-label="Раздел">
            <option value="">Раздел</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <input className="input" inputMode="decimal" style={{ width: 110 }} placeholder="%, напр. 5" value={newPct}
            onChange={(e) => setNewPct(e.target.value)} aria-label="Комиссия раздела, %" />
          <button className="btn secondary" type="submit">Своя ставка раздела</button>
        </form>
      </div>

      <div>
        <h2 className="h2" style={{ fontSize: 18, marginBottom: 12 }}>Промокоды</h2>
        {promos.length > 0 && (
          <div className="grid" style={{ gap: 6, marginBottom: 12 }}>
            {promos.map((p) => (
              <div key={p.code} className="row faint" style={{ gap: 12, fontSize: 14, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, color: 'var(--fg)' }}>{p.code}</span>
                <span>{p.type === 'percent' ? `${p.value}%` : formatPrice(String(p.value))}</span>
                <span>использован {p.usedCount}{p.maxUses ? ` из ${p.maxUses}` : ''}</span>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={createPromo} className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <input className="input" placeholder="Код" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 180 }} aria-label="Код промокода" />
          <select className="input" style={{ maxWidth: 150 }} value={promoType} onChange={(e) => setPromoType(e.target.value as 'percent' | 'fixed')} aria-label="Тип скидки">
            <option value="fixed">рублей</option>
            <option value="percent">процентов</option>
          </select>
          <input className="input" placeholder={promoType === 'percent' ? 'Скидка, %' : 'Скидка, ₽'} inputMode="decimal" value={promoValue}
            onChange={(e) => setPromoValue(e.target.value)} style={{ maxWidth: 140 }} aria-label="Размер скидки" />
          <button className="btn secondary" type="submit">Создать</button>
        </form>
        <p className="hint" style={{ marginTop: 8 }}>
          Скидка не опустит сделку в минус: её потолок считает расчёт экономики сделки.
        </p>
      </div>
    </section>
  );
}
