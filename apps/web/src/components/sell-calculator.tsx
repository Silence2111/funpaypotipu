'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { apiGet, type GameIndexEntry } from '@/lib/api';
import { formatPrice } from '@/lib/format';
import { useT } from '@/lib/i18n/client';

/** Что выходит у продавца — у нас или у конкурента (копейки строкой). */
interface Outcome {
  feePct: number;
  fee: string;
  payout: string;
  withdrawFee: string;
  net: string;
}

/** Ответ `GET /api/fees/estimate`. */
export interface SellEstimate {
  price: string;
  ours: Outcome;
  competitors: { funpay: Outcome; playerok: Outcome };
  withdrawal: { key: string; feePct: number; minFee: string };
  levelDiscountMaxPp: number;
  ratesCheckedAt: string;
}

/** Самая большая цена, которую считает калькулятор, — как у API: 10 млн ₽. */
const MAX_RUB = 10_000_000;

/**
 * Калькулятор «Сколько вы получите»: игра, раздел, цена — комиссия
 * площадки по правилу раздела, вывод на СБП и сумма на руки; рядом — то же
 * у FunPay и Playerok по их опубликованным ставкам. Без входа: раньше это
 * было видно только в форме лота после регистрации.
 */
export function SellCalculator({
  games,
  initial,
  initialGame,
  initialCategory,
  initialPrice,
}: {
  games: GameIndexEntry[];
  initial: SellEstimate | null;
  initialGame: string;
  initialCategory: string;
  initialPrice: number;
}) {
  const t = useT();
  const [gameSlug, setGameSlug] = useState(initialGame);
  const [categoryId, setCategoryId] = useState(initialCategory);
  const [price, setPrice] = useState(String(initialPrice));
  const [est, setEst] = useState<SellEstimate | null>(initial);
  const [err, setErr] = useState<string | null>(null);
  const current = useRef('');

  const game = useMemo(() => games.find((g) => g.slug === gameSlug) ?? games[0], [games, gameSlug]);
  const category = game?.categories.find((c) => c.id === categoryId) ?? game?.categories[0];
  const rub = Number(price.replace(/\s/g, '').replace(',', '.'));
  const valid = Number.isFinite(rub) && rub >= 1 && rub <= MAX_RUB;
  const minor = valid ? Math.round(rub * 100) : 0;

  useEffect(() => {
    if (!category || !valid) return;
    const key = `${category.id}:${minor}`;
    current.current = key;
    // Пересчёт — после паузы в наборе цены, а не на каждую цифру.
    const timer = setTimeout(() => {
      apiGet<SellEstimate>(`/fees/estimate?categoryId=${category.id}&price=${minor}`)
        .then((r) => {
          if (current.current !== key) return;
          setEst(r);
          setErr(null);
        })
        .catch(() => current.current === key && setErr(t('Не удалось посчитать. Попробуйте ещё раз.')));
    }, 300);
    return () => clearTimeout(timer);
  }, [category, minor, valid, t]);

  const money = (m: string) => formatPrice(m, 'RUB', t);
  const pct = (v: number) => `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(v * 100)}%`;
  const minFee = est ? money(est.withdrawal.minFee) : '';
  const sellHref = game && category ? `/cabinet/new?game=${encodeURIComponent(game.slug)}&category=${encodeURIComponent(category.slug)}` : '/cabinet/new';
  const stale = !!est && est.price !== String(minor);

  return (
    <section className="card sell-calc" aria-labelledby="sell-calc-title">
      <h2 className="h2" id="sell-calc-title" style={{ fontSize: 20 }}>{t('Сколько вы получите')}</h2>
      <div className="sell-calc-fields">
        <label className="field">
          <span className="label">{t('Игра')}</span>
          <select className="input" value={game?.slug ?? ''} onChange={(e) => {
            setGameSlug(e.target.value);
            setCategoryId(games.find((g) => g.slug === e.target.value)?.categories[0]?.id ?? '');
          }}>
            {games.map((g) => (
              <option key={g.slug} value={g.slug}>{t.d(g.title)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('Раздел')}</span>
          <select className="input" value={category?.id ?? ''} onChange={(e) => setCategoryId(e.target.value)}>
            {(game?.categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>{t.d(c.title)}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="label">{t('Цена лота, ₽')}</span>
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)}
            aria-invalid={!valid} />
        </label>
      </div>
      {!valid && <p className="field-error" role="alert">{t('Цена — от 1 до 10 000 000 ₽.')}</p>}
      {err && <p className="field-error" role="alert">{err}</p>}

      {est && (
        <div aria-live="polite" style={{ opacity: stale ? 0.6 : 1, transition: 'opacity .15s' }}>
          <dl className="sell-calc-result">
            <div>
              <dt>{t('Цена лота')}</dt>
              <dd>{money(est.price)}</dd>
            </div>
            <div>
              <dt>{t('Комиссия площадки · {pct}', { pct: pct(est.ours.feePct) })}</dt>
              <dd>−{money(est.ours.fee)}</dd>
            </div>
            <div>
              <dt>{t('Вывод на карту или СБП · {pct}, минимум {min}', { pct: pct(est.withdrawal.feePct), min: minFee })}</dt>
              <dd>−{money(est.ours.withdrawFee)}</dd>
            </div>
            <div className="sell-calc-total">
              <dt>{t('Вам на руки')}</dt>
              <dd>{money(est.ours.net)}</dd>
            </div>
          </dl>

          <h3 className="sell-calc-compare-title">{t('С той же продажи на других площадках')}</h3>
          <ul className="sell-calc-compare">
            <li>
              <span>
                <b>FunPay</b>{' '}
                <span className="faint">{t('в среднем {fee} и вывод 3%, минимум 30 ₽', { fee: pct(est.competitors.funpay.feePct) })}</span>
              </span>
              <b>{money(est.competitors.funpay.net)}</b>
            </li>
            <li>
              <span>
                <b>Playerok</b>{' '}
                <span className="faint">{t('{fee} и вывод 6%, минимум 60 ₽', { fee: pct(est.competitors.playerok.feePct) })}</span>
              </span>
              <b>{money(est.competitors.playerok.net)}</b>
            </li>
          </ul>
          <p className="faint" style={{ fontSize: 13, margin: '10px 0 0' }}>
            {t(
              'Ставки FunPay и Playerok сверены {date} по их справке и прайсам. У FunPay ставка зависит от раздела: в среднем 9%, во многих разделах от 3%. Наша комиссия снижается за продажи, рейтинг и проверенные документы — до {pp} процентных пунктов.',
              {
                date: new Date(est.ratesCheckedAt).toLocaleDateString(t.locale, { day: 'numeric', month: 'long', year: 'numeric' }),
                pp: est.levelDiscountMaxPp,
              },
            )}
          </p>
        </div>
      )}

      <Link href={sellHref} className="btn" style={{ marginTop: 16, alignSelf: 'flex-start' }}>
        {t('Выставить первый лот')}
      </Link>
    </section>
  );
}
