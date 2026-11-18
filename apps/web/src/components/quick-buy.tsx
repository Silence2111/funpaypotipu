'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { GameIcon } from './game-icon';
import { useT } from '@/lib/i18n/client';
import { gameIcon } from '@/lib/game-icons';

export type QuickOffer = { id: string; title: string; price: string; full: string; color: string; big: string; unit: string; art: string };
export type QuickTab = {
  key: string;
  slug: string;
  title: string;
  section: string;
  from?: string | null;
  href: string;
  color: string;
  art: string;
  big: string;
  offers: QuickOffer[];
};
export type QuickSteam = { title: string; sub: string; color: string; art: string; big: string; form: ReactNode };

/**
 * Быстрая покупка плитой по образцу Playerok (18.11.2026, второй заход: «пополнить Steam доработать как у Playerok»):
 * слева вертикальная лента сервисов, рядом крупная плитка товара с объёмным предметом, справа название, поля в белых
 * окошках и большая кнопка. Steam — пополнение по логину; остальные — выбор из самых дешёвых настоящих лотов раздела.
 * Форма Steam не размонтируется: логин и сумма не теряются при переключении.
 */
export function QuickBuy({ steam, tabs }: { steam: QuickSteam | null; tabs: QuickTab[] }) {
  const t = useT();
  const rail = [...(steam ? [{ key: 'steam', slug: 'steam', title: 'Steam' }] : []), ...tabs];
  const [on, setOn] = useState(rail[0]?.key ?? '');
  const [pick, setPick] = useState<Record<string, string>>({});
  if (!rail.length) return null;
  const cur = tabs.find((x) => x.key === on);
  const tile = on === 'steam' && steam ? steam : cur;
  // Знак сервиса на плитке (владелец: «лого Steam нельзя вставить?»): у Steam — крупно вместо безликой карты,
  // у остальных — значком в углу рядом с предметом
  const mark = gameIcon(on === 'steam' ? 'steam' : cur?.slug ?? '');
  const chosen = cur ? cur.offers.find((o) => o.id === pick[cur.key]) ?? cur.offers[0] : null;

  return (
    <section className="qb2" aria-label={t('Быстрая покупка')}>
      <div className="qb2__rail" role="tablist" aria-label={t('Сервисы')}>
        {rail.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={on === x.key}
            className={on === x.key ? 'on' : ''}
            onClick={() => setOn(x.key)}
            title={t.d(x.title)}
          >
            <GameIcon slug={x.slug} title={x.title} size={32} />
          </button>
        ))}
      </div>
      <div className="qb2__card">
        {tile && (
          <div className={on === 'steam' && mark ? 'qb2__tile qb2__tile--logo' : 'qb2__tile'} style={{ ['--c' as string]: tile.color }} aria-hidden>
            <span className="qb2__big">{tile.big}</span>
            {mark && <span className="qb2__mark" style={{ background: mark.glyph, WebkitMaskImage: `url(${mark.src})`, maskImage: `url(${mark.src})` }} />}
            {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
            <img src={tile.art} alt="" />
          </div>
        )}
        <div className="qb2__body">
          {steam && (
            <div hidden={on !== 'steam'}>
              <h2 className="qb2__h">
                {steam.title} <small>{steam.sub}</small>
              </h2>
              {steam.form}
            </div>
          )}
          {cur && chosen && (
            <div className="qb2__form">
              <h2 className="qb2__h">
                {t('{section} {game}', { section: t.d(cur.section), game: t.d(cur.title) })}
                {cur.from && <span className="qb2__from">{t('от {price}', { price: cur.from })}</span>}
                <small>{t('Самые дешёвые предложения сейчас, с гарантией сделки')}</small>
              </h2>
              <div className="qb2__row qb2__row--sel">
                <label className="qb2__f qb2__f--sel">
                  <span>{t('Что купить')}</span>
                  <select value={chosen.id} onChange={(e) => setPick((p) => ({ ...p, [cur.key]: e.target.value }))}>
                    {cur.offers.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title} · {o.full}
                      </option>
                    ))}
                  </select>
                </label>
                <Link href={`/lot/${chosen.id}`} className="qb2__pay">
                  {t('Купить за {price}', { price: chosen.price })}
                </Link>
              </div>
              <div className="qb2__row2">
                <div className="qb2__chips">
                  {cur.offers.map((o) => (
                    <button key={o.id} type="button" aria-pressed={o.id === chosen.id} onClick={() => setPick((p) => ({ ...p, [cur.key]: o.id }))}>
                      {o.price}
                    </button>
                  ))}
                </div>
                <div className="qb2__tags">
                  <span className="qb2__tag">{t('Гарантия сделки')}</span>
                  <Link href={cur.href} className="qb2__note">
                    {t('Все предложения')} →
                  </Link>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
