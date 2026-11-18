'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { GameIcon } from './game-icon';
import { useT } from '@/lib/i18n/client';

export type QuickOffer = { id: string; title: string; price: string; color: string; big: string; unit: string; art: string };
export type QuickTab = { key: string; slug: string; title: string; section: string; from?: string | null; href: string; offers: QuickOffer[] };

/**
 * Быстрая покупка вкладками сервисов, как «Пополнение сервисов» у GGSel и «Моментальная покупка» у Kupikod
 * (18.11.2026): на Steam — пополнение по логину, на остальных вкладках — самые дешёвые настоящие лоты
 * раздела, нажал — и на странице лота. Форма Steam не размонтируется: логин и сумма не теряются.
 */
export function QuickBuy({ steam, tabs }: { steam: ReactNode | null; tabs: QuickTab[] }) {
  const t = useT();
  const all = [...(steam ? [{ key: 'steam', slug: 'steam', title: 'Steam' }] : []), ...tabs];
  const [on, setOn] = useState(all[0]?.key ?? '');
  if (!all.length) return null;
  const cur = tabs.find((x) => x.key === on);
  return (
    <section className="tw qb" aria-label={t('Быстрая покупка')}>
      <div className="tw__svc" role="tablist" aria-label={t('Сервисы')}>
        {all.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={on === x.key}
            className={on === x.key ? 'tw__s tw__s--on' : 'tw__s'}
            onClick={() => setOn(x.key)}
            title={t.d(x.title)}
          >
            <GameIcon slug={x.slug} title={x.title} size={34} />
          </button>
        ))}
      </div>
      {steam && <div hidden={on !== 'steam'} className="qb__pane">{steam}</div>}
      {cur && (
        <div className="qb__pane qb__offers" role="tabpanel">
          <div className="tw__head">
            <h2>
              {t('{section} {game}', { section: t.d(cur.section), game: t.d(cur.title) })}
              {cur.from && <span className="tw__pct">{t('от {price}', { price: cur.from })}</span>}
            </h2>
            <p>{t('Самые дешёвые предложения сейчас, с гарантией сделки')}</p>
          </div>
          <div className="qb__list">
            {cur.offers.map((o) => (
              <Link key={o.id} href={`/lot/${o.id}`} className="qb__o">
                <span className="qb__c" style={{ ['--c' as string]: o.color }}>
                  <b>{o.big}</b>
                  {o.unit && <span>{o.unit}</span>}
                  {/* eslint-disable-next-line @next/next/no-img-element -- свой рендер */}
                  <img src={o.art} alt="" />
                </span>
                <span className="qb__t">{o.title}</span>
                <span className="qb__p">{o.price}</span>
              </Link>
            ))}
            <Link href={cur.href} className="qb__all">
              {t('Все предложения')} →
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
