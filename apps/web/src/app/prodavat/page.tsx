import type { Metadata } from 'next';
import Link from 'next/link';
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
      'Сколько вы получите с продажи скина, ключа или валюты: комиссия, вывод и сумма на руки до регистрации, рядом со ставками FunPay и Playerok.',
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
    <div className="container stack-lg sell-page">
      {/* Первый экран: зачем продавать здесь и кнопка слева, калькулятор справа — продавец
          видит свою сумму на руки до регистрации. */}
      <section className="sell-hero">
        <div className="sell-hero__text">
          <h1 className="h1">{t('Продавать на GameMarket')}</h1>
          <p className="lead">
            {t('Посчитайте, сколько получите с продажи, ещё до регистрации. Комиссия берётся только с проданного, выставлять лоты бесплатно.')}
          </p>
          <Link href="/cabinet/new" className="btn">
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
          <p className="muted">{t('Калькулятор сейчас недоступен. Попробуйте обновить страницу.')}</p>
        )}
      </section>

      <section aria-labelledby="sell-how">
        <h2 className="h2" id="sell-how">{t('Как устроена продажа')}</h2>
        <div className="sell-how">
          <div>
            <h3>{t('Деньги ждут в сделке')}</h3>
            <p>
              {t('Покупатель платит площадке, деньги ждут в сделке. Вы выдали товар, покупатель подтвердил, и деньги на вашем балансе.')}
              {pricing?.autoConfirmHours !== undefined && (
                <>
                  {' '}
                  {t('Если покупатель не подтвердил и не открыл спор, через {h} ч сделка подтвердится сама.', { h: pricing.autoConfirmHours })}
                </>
              )}
            </p>
          </div>
          <div>
            <h3>{t('Автовыдача')}</h3>
            <p>{t('Ключи и коды можно выдавать автоматически. Загрузите их на склад лота, и покупатель получит товар сразу после оплаты.')}</p>
          </div>
          <div>
            <h3>{t('API для продавцов')}</h3>
            <p>
              {t('Свой бот или склад подключается через API по ключу, пароль от аккаунта не нужен.')}{' '}
              <Link href="/prodavat/api" className="inline-link">{t('Подробнее')}</Link>
            </p>
          </div>
          {pricing?.fulfillHours !== undefined && (
            <div>
              <h3>{t('Срок выдачи')}</h3>
              <p>
                {t('При ручной выдаче на неё есть {h} ч после оплаты. Иначе заказ отменится и деньги вернутся покупателю.', {
                  h: pricing.fulfillHours,
                })}
              </p>
            </div>
          )}
          {pricing && sbp && (
            <div>
              <h3>{t('Вывод денег')}</h3>
              <p>
                {t('Вывод на карту, СБП и ЮMoney {pct}, в USDT {usdt}. Комиссия продавца снижается за продажи, рейтинг и проверенные документы.', {
                  pct: pct(sbp.feePct),
                  usdt: pct(pricing.withdrawal.find((w) => w.key === 'usdt')?.feePct ?? 0),
                })}
              </p>
            </div>
          )}
        </div>
      </section>

      {start && <MoveLots games={games} initialGame={start.slug} />}
    </div>
  );
}
