'use client';

import { useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
// Подпути, а не корень пакета: shared собран в CommonJS и не тришейкается,
// а корень тянет в браузер zod и все контракты — +25 kB на главной.
import {
  markupLabel,
  pickTopupOffer,
  topupAccountError,
  topupAccountSpec,
  topupAmountError,
  topupQuote,
  topupRange,
} from '@gamemarket/shared/topup';
import { isDemoSeller } from '@gamemarket/shared/demo';
import type { TopupOffer } from '@/lib/api';
import { apiFetch, getToken } from '@/lib/session';
import { apiErrorMessage } from '@/lib/errors';
import { payOrder } from '@/lib/checkout';
import { formatPrice } from '@/lib/format';
import { tileFor } from '@/lib/tile';
import { useT } from '@/lib/i18n/client';
import { msg } from '@/lib/i18n/lang';
import { PayMethods, methodFee, priceFor, type PayMethod } from '@/components/pay-methods';

/** Быстрые суммы, ₽: самые частые пополнения кошелька. */
const PRESETS = [500, 1000, 2000, 5000];
const DEFAULT_RUB = 1000;

/**
 * Пополнение на сумму покупателя: логин, сумма, «Оплатить N ₽».
 *
 * Это самый короткий путь к первой покупке: у Playerok такой виджет стоит
 * в первом экране, и человек платит, не уходя с главной. Цена считается тут
 * же, той же функцией из shared, что и заказ на сервере, — цифра на кнопке
 * не расходится с суммой в заказе, а ввод суммы не ходит в сеть.
 *
 * `hero` — карточка в первом экране главной, с заголовком и продавцом;
 * `lot` — форма в панели покупки на странице лота.
 */
export function GameTopupForm({
  game,
  offers,
  variant,
  returnPath,
  initialAccount = '',
  initialAmount = '',
  paymentsDemo = false,
}: {
  game: { slug: string; title: string };
  offers: TopupOffer[];
  variant: 'hero' | 'lot';
  /** Куда вернуться после входа или регистрации — путь страницы с формой. */
  returnPath: string;
  initialAccount?: string;
  initialAmount?: string;
  paymentsDemo?: boolean;
}) {
  const t = useT();
  const rub = (minor: bigint) => formatPrice(minor.toString(), 'RUB', t);
  // Проценты из shared — с запятой («7,5%»); по-английски — с точкой.
  const pctText = (s: string) => (t.lang === 'en' ? s.replace(',', '.') : s);
  const router = useRouter();
  const terms = useMemo(
    () => offers.map((o) => ({ ...o, min: BigInt(o.min), max: BigInt(o.max) })),
    [offers],
  );
  const range = topupRange(terms);
  const spec = topupAccountSpec(game.slug);

  const [account, setAccount] = useState(initialAccount);
  const [amount, setAmount] = useState(() => {
    if (/^\d{1,7}$/.test(initialAmount)) return initialAmount;
    const fallback = BigInt(DEFAULT_RUB * 100);
    return range && (fallback < range.min || fallback > range.max)
      ? String(range.min / 100n)
      : String(DEFAULT_RUB);
  });
  const [touched, setTouched] = useState({ account: false, amount: false });
  const [busy, setBusy] = useState(false);
  const [method, setMethod] = useState<PayMethod>('sbp');
  const [err, setErr] = useState<string | null>(null);

  const nominal = amount ? BigInt(amount) * 100n : 0n;
  const offer = nominal > 0n ? pickTopupOffer(terms, nominal) : null;
  const quote = offer ? topupQuote(nominal, offer.markupBps) : null;
  const amountError = offer
    ? null
    : (range ? topupAmountError(nominal, range) : null) ?? msg('На эту сумму предложений сейчас нет');
  const accountError = topupAccountError(game.slug, account);
  // Проверки из shared пишут по-русски — показываем через t.d (словарь EN_SHARED).
  const showAccountError = touched.account && accountError ? t.d(accountError) : null;
  const showAmountError = touched.amount && amountError ? t.d(amountError) : null;
  const presets = PRESETS.filter((p) => !range || (BigInt(p * 100) >= range.min && BigInt(p * 100) <= range.max));

  async function pay() {
    setTouched({ account: true, amount: true });
    setErr(null);
    if (accountError || amountError || !offer || !quote) return;

    if (!getToken()) {
      // После входа вернуться к форме с тем же логином и суммой.
      const qs = new URLSearchParams({ account: account.trim(), amount });
      const back = `${returnPath}?${qs}${variant === 'hero' ? '#topup' : ''}`;
      const page = method === 'balance' ? 'login' : 'register';
      router.push(`/${page}?next=${encodeURIComponent(back)}`);
      return;
    }

    setBusy(true);
    let orderId: string;
    try {
      const order = await apiFetch<{ id: string }>('/orders', {
        method: 'POST',
        body: JSON.stringify({
          listingId: offer.listingId,
          account: account.trim(),
          topupAmount: quote.nominal.toString(),
        }),
      });
      orderId = order.id;
    } catch (e) {
      setErr(apiErrorMessage(e, t('Не удалось оформить пополнение. Обновите страницу и попробуйте ещё раз.')));
      setBusy(false);
      return;
    }
    try {
      // Шлюз с переходом — дальше страница оплаты, вернёт на заказ сам.
      if ((await payOrder(orderId, method)) === 'redirect') return;
      router.push(`/orders/${orderId}`);
    } catch {
      // Заказ уже создан: оплатить его другим способом можно на его странице.
      router.push(`/orders/${orderId}?pay=failed`);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void pay();
  }

  const tile = tileFor(game.title);
  const demo = offer ? isDemoSeller(offer.seller.username) : false;
  const ids = { account: `topup-account-${variant}`, amount: `topup-amount-${variant}` };

  const form = (
    <form onSubmit={onSubmit} noValidate className="stack-form" style={{ gap: 16 }}>
      <div className="field">
        <label className="label" htmlFor={ids.account}>
          {t.d(spec.label)}
        </label>
        <input
          id={ids.account}
          className="input"
          value={account}
          placeholder={t.d(spec.placeholder)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={120}
          aria-invalid={!!showAccountError}
          aria-describedby={`${ids.account}-note`}
          onChange={(e) => setAccount(e.target.value)}
          onBlur={() => setTouched((prev) => ({ ...prev, account: true }))}
        />
        {showAccountError ? (
          <p id={`${ids.account}-note`} className="field-error" role="alert">
            {showAccountError}
          </p>
        ) : (
          <p id={`${ids.account}-note`} className="hint">
            {t.d(spec.hint)}
          </p>
        )}
      </div>

      <div className="field">
        <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
          <label className="label" htmlFor={ids.amount}>
            {t('Сколько зачислить')}
          </label>
          {range && (
            <span className="faint" style={{ fontSize: 13 }}>
              {rub(range.min)} – {rub(range.max)}
            </span>
          )}
        </div>
        <div className="input-suffix">
          <input
            id={ids.amount}
            className="input topup-amount"
            value={amount}
            inputMode="numeric"
            autoComplete="off"
            aria-invalid={!!showAmountError}
            aria-describedby={showAmountError ? `${ids.amount}-note` : undefined}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7))}
            onBlur={() => setTouched((prev) => ({ ...prev, amount: true }))}
          />
          <span aria-hidden>₽</span>
        </div>
        {showAmountError && (
          <p id={`${ids.amount}-note`} className="field-error" role="alert">
            {showAmountError}
          </p>
        )}
        {presets.length > 0 && (
          <div className="topup-presets" role="group" aria-label={t('Быстрый выбор суммы')}>
            {presets.map((p) => (
              <button
                key={p}
                type="button"
                className="chip"
                aria-pressed={amount === String(p)}
                onClick={() => {
                  setAmount(String(p));
                  setTouched((prev) => ({ ...prev, amount: true }));
                }}
              >
                {rub(BigInt(p * 100))}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="topup-summary">
        <div className="total">
          <span>{t('К оплате')}</span>
          <strong>{quote ? rub(priceFor(quote.price, method)) : '—'}</strong>
        </div>
        {quote && offer && (
          <p>
            {t('{sum} на {game} + наценка продавца {markup}', {
              sum: rub(quote.nominal),
              game: t.d(game.title),
              markup: pctText(markupLabel(offer.markupBps)),
            })}
            {methodFee(method) ? ` ${t('+ комиссия способа {fee}', { fee: pctText(methodFee(method) ?? '') })}` : ''}
          </p>
        )}
      </div>

      <PayMethods
        id={`pay-method-${variant}`}
        base={quote ? quote.price : null}
        currency="RUB"
        value={method}
        onChange={setMethod}
        variant={variant === 'hero' ? 'select' : 'list'}
      />

      <div>
        <button className="btn block lg" type="submit" disabled={busy}>
          {busy
            ? t('Оформляем…')
            : quote
              ? t('Оплатить {sum}', { sum: rub(priceFor(quote.price, method)) })
              : t('Оплатить')}
        </button>
        {err && (
          <p className="field-error" role="alert" style={{ marginTop: 10, textAlign: 'center' }}>
            {err}
          </p>
        )}
      </div>

      {variant === 'hero' && (
        <p className="hint" style={{ textAlign: 'center' }}>
          {t('Деньги у площадки, пока вы не подтвердите зачисление.')}
          {paymentsDemo ? ` ${t('Оплата демонстрационная, деньги не списываются.')}` : ''}
          {offer && (
            <>
              {' '}
              {t('Продавец {name}', { name: offer.seller.username ?? '—' })}
              {demo && <> <span className="demo-mark">{t('Пример')}</span></>},{' '}
              <Link href={`/lot/${offer.listingId}`} className="inline-link">
                {t('условия лота')}
              </Link>
              .
            </>
          )}
        </p>
      )}
    </form>
  );

  if (variant === 'lot') return form;

  return (
    <div id="topup" className="card topup-card">
      <div className="row" style={{ gap: 12, marginBottom: 16 }}>
        <div
          aria-hidden
          style={{
            width: 44,
            height: 44,
            flex: 'none',
            borderRadius: 12,
            background: tile.background,
            color: tile.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          {tile.initials}
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 className="h2" style={{ fontSize: 20 }}>
            {t('Пополнить {game}', { game: t.d(game.title) })}
          </h2>
          <p className="faint" style={{ margin: 0, fontSize: 13 }}>
            {t('Без пароля — нужен только логин')}
          </p>
        </div>
      </div>
      {form}
    </div>
  );
}
