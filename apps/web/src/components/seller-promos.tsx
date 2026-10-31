'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import {
  SELLER_PROMO_MAX_PCT,
  SELLER_PROMO_MIN_PCT,
  normalizePromoCode,
} from '@gamemarket/shared/seller-promo';
import { apiFetch } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/lang';

interface Promo {
  id: string;
  code: string;
  percent: number;
  maxUses: number | null;
  used: number;
  validUntil: string | null;
  repeatOnly: boolean;
  active: boolean;
}

const TERMS = [7, 30, 0] as const;
const termLabel = (d: number, t: T) => (d ? t('{n} дней', { n: d }) : t('без срока'));
const dateOf = (iso: string, t: T) =>
  new Date(iso).toLocaleDateString(t.locale, { day: 'numeric', month: 'long' });

/**
 * «Инструменты → Промокоды»: свой код со скидкой за свой счёт. Скидка —
 * от цены лота до комиссии; код — один раз на покупателя, с пределом,
 * сроком и «только тем, кто уже покупал».
 */
export function SellerPromos() {
  const t = useT();
  const [list, setList] = useState<Promo[] | null>(null);
  const [code, setCode] = useState('');
  const [pct, setPct] = useState('10');
  const [uses, setUses] = useState('');
  const [days, setDays] = useState<number>(30);
  const [repeat, setRepeat] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    apiFetch<Promo[]>('/seller-promos')
      .then(setList)
      .catch(() => setList([]));
  }, []);

  async function run(fn: () => Promise<void>, ok: string, fail: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: ok });
    } catch (e) {
      setMsg({ ok: false, text: apiErrorMessage(e, fail) });
    } finally {
      setBusy(false);
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(
      async () => {
        const p = await apiFetch<Promo>('/seller-promos', {
          method: 'POST',
          body: JSON.stringify({
            code: normalizePromoCode(code),
            percent: Number(pct),
            maxUses: uses.trim() ? Number(uses) : null,
            days: days || null,
            repeatOnly: repeat,
          }),
        });
        setList((l) => [p, ...(l ?? [])]);
        setCode('');
      },
      t('Промокод создан.'),
      t('Не удалось создать промокод.'),
    );
  }

  const toggle = (p: Promo) =>
    run(
      async () => {
        await apiFetch(`/seller-promos/${p.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ active: !p.active }),
        });
        setList((l) => l?.map((x) => (x.id === p.id ? { ...x, active: !p.active } : x)) ?? null);
      },
      p.active ? t('Промокод выключен.') : t('Промокод включён.'),
      t('Не удалось сохранить.'),
    );

  const remove = (p: Promo) =>
    run(
      async () => {
        await apiFetch(`/seller-promos/${p.id}`, { method: 'DELETE' });
        setList((l) => l?.filter((x) => x.id !== p.id) ?? null);
      },
      t('Промокод удалён.'),
      t('Не удалось удалить промокод.'),
    );

  return (
    <section className="card tools-card">
      <h2 className="h2 tools-title">{t('Промокоды')}</h2>
      <p className="muted tools-text">
        {t(
          'Свой код со скидкой за ваш счёт: цена снижается до расчёта комиссии. Покупатель вводит его при оплате; один покупатель — один раз.',
        )}
      </p>
      {msg && (
        <div
          className={msg.ok ? 'alert success' : 'alert error'}
          role={msg.ok ? 'status' : 'alert'}
        >
          {msg.text}
        </div>
      )}
      {list && list.length > 0 && (
        <ul className="tools-templates">
          {list.map((p) => {
            const over = !!p.validUntil && new Date(p.validUntil).getTime() <= Date.now();
            return (
              <li key={p.id} className="tools-template">
                <div className="tools-template-main">
                  <div className="tools-template-title">
                    <span className="promo-code">{p.code}</span> −{p.percent}%
                    {p.repeatOnly && <span className="badge">{t('постоянным')}</span>}
                    {(!p.active || over) && (
                      <span className="badge">{over ? t('срок вышел') : t('выключен')}</span>
                    )}
                  </div>
                  <div className="tools-template-body">
                    {p.maxUses
                      ? t('использований: {used} из {max}', { used: p.used, max: p.maxUses })
                      : t('использований: {used}', { used: p.used })}
                    {' · '}
                    {p.validUntil
                      ? t('до {date}', { date: dateOf(p.validUntil, t) })
                      : t('без срока')}
                  </div>
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <button
                    type="button"
                    role="switch"
                    className="switch"
                    aria-checked={p.active}
                    aria-label={t('Промокод {code} включён', { code: p.code })}
                    disabled={busy}
                    onClick={() => void toggle(p)}
                  >
                    <span className="switch-track" aria-hidden>
                      <span className="switch-thumb" />
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    disabled={busy}
                    aria-label={t('Удалить промокод {code}', { code: p.code })}
                    title={t('Удалить')}
                    onClick={() => void remove(p)}
                  >
                    <Trash2 size={16} strokeWidth={1.75} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form className="stack-form" style={{ gap: 10 }} onSubmit={add}>
        <div className="promo-form-row">
          <input
            className="input input-mono"
            value={code}
            maxLength={20}
            aria-label={t('Код')}
            placeholder={t('Например SUMMER10')}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
          />
          <label className="sale-pct">
            <input
              className="input"
              inputMode="numeric"
              value={pct}
              maxLength={2}
              aria-label={t('Скидка, %')}
              onChange={(e) => setPct(e.target.value.replace(/\D/g, ''))}
            />
            %
          </label>
        </div>
        <div className="sale-row">
          <span className="label">{t('Срок')}</span>
          {TERMS.map((d) => (
            <button
              key={d}
              type="button"
              className="chip"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
            >
              {termLabel(d, t)}
            </button>
          ))}
        </div>
        <input
          className="input"
          inputMode="numeric"
          value={uses}
          maxLength={5}
          aria-label={t('Сколько раз можно использовать')}
          placeholder={t('Сколько раз — без лимита')}
          onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))}
        />
        <label className="row" style={{ gap: 8, alignItems: 'center', fontSize: 14 }}>
          <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
          {t('Только тем, кто уже покупал у вас')}
        </label>
        <p className="hint" style={{ margin: 0 }}>
          {t('Скидка — от {min} до {max}%. Не действует на пополнения.', {
            min: SELLER_PROMO_MIN_PCT,
            max: SELLER_PROMO_MAX_PCT,
          })}
        </p>
        <div>
          <button className="btn" type="submit" disabled={busy || code.length < 4 || !pct}>
            {t('Создать промокод')}
          </button>
        </div>
      </form>
    </section>
  );
}
