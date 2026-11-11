import type { Metadata } from 'next';
import Link from 'next/link';
import { Clock, Percent, ShieldCheck, Zap } from 'lucide-react';
import { apiTry, getGameIndex, getPublicPricing } from '@/lib/api';
import { getT } from '@/lib/i18n/server';
import { SellCalculator, type SellEstimate } from '@/components/sell-calculator';
import { MoveLots } from '@/components/move-lots';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
/** С чего калькулятор начинает: скины CS2 за 1 000 ₽ (аккаунты закрыты, часть 122). */
const START = { game: 'cs2', price: 1000 };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Продавать на GameMarket'),
    description: t(
      'Сколько вы получите с продажи скина, ключа или валюты — комиссия, вывод и сумма на руки до регистрации, рядом со ставками FunPay и Playerok.',
    ),
    alternates: { canonical: `${SITE}/prodavat` },
  };
}

/**
 * «Продавать на GameMarket»: калькулятор без входа и коротко — как устроена
 * продажа. Раньше «сколько вы получите» было видно только в форме лота,
 * после регистрации, а продавцу, который пришёл посмотреть, — нигде.
 */
export default async function SellPage() {
  const t = await getT();
  const [index, pricing] = await Promise.all([getGameIndex(), getPublicPricing()]);
  // Закрытые для продажи разделы (часть 122) в калькуляторе не предлагаем.
  const games = (index ?? [])
    .map((g) => ({ ...g, categories: g.categories.filter((c) => !c.salesClosed) }))
    .filter((g) => g.categories.length > 0);
  const start = games.find((g) => g.slug === START.game) ?? games[0];
  const category = start?.categories.find((c) => c.slug === 'skins') ?? start?.categories[0];
  // Первый расчёт — на сервере: страница с цифрами приходит целиком.
  const initial = category
    ? await apiTry<SellEstimate>(`/fees/estimate?categoryId=${category.id}&price=${START.price * 100}`)
    : null;
  const pct = (v: number) => `${new Intl.NumberFormat(t.locale, { maximumFractionDigits: 1 }).format(v * 100)}%`;
  const sbp = pricing?.withdrawal.find((w) => w.key === 'sbp');

  return (
    <div className="container stack-lg" style={{ paddingTop: 48, maxWidth: 760 }}>
      <div>
        <h1 className="h1" style={{ fontSize: 32 }}>{t('Продавать на GameMarket')}</h1>
        <p className="lead">
          {t('Посчитайте, сколько получите с продажи, — до регистрации. Комиссия берётся только с проданного, выставлять лоты бесплатно.')}
        </p>
        {/* Кнопка — в первом экране телефона: калькулятор её ниже уводит. */}
        <Link href="/cabinet/new" className="btn" style={{ marginTop: 16 }}>
          {t('Выставить лот')}
        </Link>
      </div>

      {start && category ? (
        <SellCalculator
          games={games}
          initial={initial}
          initialGame={start.slug}
          initialCategory={category.id}
          initialPrice={START.price}
        />
      ) : (
        <p className="muted">{t('Калькулятор сейчас недоступен — попробуйте обновить страницу.')}</p>
      )}

      {start && <MoveLots games={games} initialGame={start.slug} />}

      <section aria-labelledby="sell-how">
        <h2 className="h2" id="sell-how" style={{ fontSize: 22, marginBottom: 16 }}>{t('Как устроена продажа')}</h2>
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0, gap: 14 }}>
          <li className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <ShieldCheck size={20} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {t('Покупатель платит площадке, деньги ждут в сделке. Выдали товар, покупатель подтвердил — деньги на вашем балансе.')}
              {pricing?.autoConfirmHours !== undefined && (
                <span className="faint">
                  {' '}
                  {t('Не подтвердил и не открыл спор — через {h} ч подтверждение само.', { h: pricing.autoConfirmHours })}
                </span>
              )}
            </span>
          </li>
          <li className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Zap size={20} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{t('Ключи и коды можно выдавать автоматически: загрузите их на склад лота — покупатель получит сразу после оплаты.')}</span>
          </li>
          <li className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
            <Zap size={20} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {t('Свой бот или склад — через API по ключу, без пароля от аккаунта.')}{' '}
              <Link href="/prodavat/api" style={{ color: 'var(--accent)' }}>{t('API для продавцов')}</Link>
            </span>
          </li>
          {pricing?.fulfillHours !== undefined && (
            <li className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Clock size={20} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t('Ручная выдача — в течение {h} ч после оплаты, иначе заказ отменится и деньги вернутся покупателю.', {
                  h: pricing.fulfillHours,
                })}
              </span>
            </li>
          )}
          {pricing && sbp && (
            <li className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Percent size={20} strokeWidth={1.75} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                {t('Вывод на карту, СБП и ЮMoney — {pct}, в USDT — {usdt}. Комиссия продавца снижается за продажи, рейтинг и проверенные документы.', {
                  pct: pct(sbp.feePct),
                  usdt: pct(pricing.withdrawal.find((w) => w.key === 'usdt')?.feePct ?? 0),
                })}
              </span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
