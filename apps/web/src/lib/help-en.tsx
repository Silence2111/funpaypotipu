import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  LEVEL_RULES,
  PAYMENT_METHODS,
  PROMO_DAYS,
  SELLER_LEVELS,
  WITHDRAWAL_METHODS,
  bumpCooldownHours,
  DISPUTE_RESPONSE_HOURS,
} from '@gamemarket/shared';
import type { HelpSlug, Terms } from './help';
import { formatPrice } from './format';
import type { T } from './i18n/lang';

/**
 * Статьи «Помощи» по-английски. Тот же смысл и те же цифры, что в русских
 * (help.tsx): условия — из `Terms`, подписи уровней и способов вывода — из
 * общего словаря через t.d(). Record по HelpSlug — без английского текста
 * статья не соберётся.
 */

const nf = (digits: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits });
/** 0.044 → «4.4%». */
const pct = (v: number) => `${nf(1).format(v * 100)}%`;
/** 150 bps → «1.5 pp». */
const pp = (bps: number) => `${nf(1).format(bps / 100)} pp`;
const rating = (v: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 1 }).format(v);
const hours = (h: number) => `${h} ${h === 1 ? 'hour' : 'hours'}`;
const days = (d: number) => `${d} ${d === 1 ? 'day' : 'days'}`;
const fee = (m: (typeof WITHDRAWAL_METHODS)[number], t: T) =>
  m.minFee > 0n
    ? `${pct(m.feePct)}, at least ${formatPrice(m.minFee.toString(), 'RUB', t)}`
    : pct(m.feePct);

/** Способ оплаты внутри фразы. */
const METHOD_WORDS: Record<string, string> = {
  balance: 'balance',
  sbp: 'SBP',
  crypto: 'crypto',
  card: 'card',
};
const listEn = (words: string[]) =>
  words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
    : (words[0] ?? '');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Способы с надбавкой или без — только те, что принимает шлюз: у ЮKassa нет криптовалюты. */
const methodsWhere = (paidOnly: boolean, c: Terms) =>
  listEn(
    PAYMENT_METHODS.filter(
      (m) =>
        m.feePct > 0 === paidOnly &&
        (m.key === 'balance' || !c.payMethods || c.payMethods.includes(m.key)),
    ).map((m) => METHOD_WORDS[m.key] ?? m.label),
  );
const surcharge = pct(PAYMENT_METHODS.find((m) => m.feePct > 0)?.feePct ?? 0);
const feeRange = (c: Terms) =>
  c.feeMin === c.feeMax ? pct(c.feeMin) : `${pct(c.feeMin).replace('%', '')}–${pct(c.feeMax)}`;
const levelHours = (c: Terms, key: keyof typeof SELLER_LEVELS) =>
  hours(Math.min(SELLER_LEVELS[key].holdHours, c.confirmHours));

export const EN_BODIES: Record<HelpSlug, (c: Terms, t: T) => ReactNode> = {
  'kak-kupit': (c) => (
    <>
      <ol className="help-steps">
        <li>
          <b>Find the game and category.</b> Game search in the header understands short names:
          “cs”, “wow”, “gta”. In a category you can filter by parameters, show only sellers who are
          online and sort by price.
        </li>
        <li>
          <b>Choose an offer.</b> Each row shows the seller: rating, number of reviews and whether
          they are online. Ask a question before buying with “Message the seller” right on the
          listing page.
        </li>
        <li>
          <b>Pay.</b> {cap(methodsWhere(false, c))} — no surcharge; {methodsWhere(true, c)} — plus{' '}
          {surcharge} to the payment system. The total for each method is shown before you pay.
        </li>
        <li>
          <b>Get the goods.</b> Keys, top-ups and listings marked “Delivered right after payment”
          arrive instantly. Anything else the seller hands over in the order chat — they have{' '}
          {hours(c.fulfillHours)}. If they don’t make it, the money returns to your balance
          automatically.
        </li>
        <li>
          <b>Check and confirm.</b> If everything is fine, press “Confirm receipt”: the seller gets
          paid and you get {pct(c.cashback)} cashback on your balance. If something is wrong, press
          “Open a dispute”. If you do neither, the order is confirmed automatically when the check
          period ends.
        </li>
        <li>
          <b>Leave a review.</b> A rating, a few words and up to 5 photos — screenshots of the item
          or the game. The seller’s future buyers will see it; you can edit or delete it within 14
          days.
        </li>
      </ol>
      <h2>How long you have to check</h2>
      <p>The period is shown on the order page and depends on the goods and the seller:</p>
      <ul>
        <li>
          delivered automatically — keys, top-ups, goods from the seller’s stock —{' '}
          {hours(c.autoGoodsHours)};
        </li>
        <li>
          from a newcomer seller — {levelHours(c, 'new')}, from a “Trusted” one —{' '}
          {levelHours(c, 'trusted')}, from a Pro — {levelHours(c, 'pro')}.
        </li>
      </ul>
      <p>
        Check before confirming: after that the money goes to the seller and a dispute can no longer
        be opened. What to do if something goes wrong — see{' '}
        <Link href="/pomosch/spory">“Disputes and refunds”</Link>.
      </p>
    </>
  ),

  spory: (c) => (
    <>
      <p>
        Until the order is confirmed, the money is held by the marketplace — the seller hasn’t
        received it yet.
      </p>
      <h2>When to open a dispute</h2>
      <ul>
        <li>the goods didn’t arrive, or the wrong goods arrived;</li>
        <li>the account doesn’t match the description, or the key doesn’t activate;</li>
        <li>the seller asks for an extra payment or to move to a messenger.</li>
      </ul>
      <p>
        The “Open a dispute” button is on the order page, from payment until confirmation. The
        seller can open a dispute too — for example, if the buyer doesn’t provide the details needed
        to deliver the goods.
      </p>
      <h2>How a dispute is resolved</h2>
      <p>
        An arbiter from the marketplace joins the order. They review the order chat and the
        evidence: screenshots, videos, files. Write in the order chat — the arbiter can’t see
        conversations in third-party messengers.
      </p>
      <p>
        The decision is either payment to the seller or a refund to the buyer. Refunds go to your
        balance: you can buy something else with it or withdraw the money.
      </p>
      <ul>
        <li>
          The other side has {hours(DISPUTE_RESPONSE_HOURS)} to reply — the deadline is shown on the
          dispute page. The arbiter can ask for an explanation with the same deadline. Silence
          counts against whoever stayed silent: the arbiter decides on what’s there.
        </li>
        <li>
          Settled it between you — the dispute closes without an arbiter: the buyer presses “No
          claims — complete the deal”, the seller presses “Refund the buyer”.
        </li>
      </ul>
      <h2>Refunds without a dispute</h2>
      <ul>
        <li>
          The seller didn’t deliver within {hours(c.fulfillHours)} — the money returns to your
          balance automatically.
        </li>
        <li>A key or top-up failed to deliver — also automatically.</li>
        <li>
          The seller can refund you before confirmation — with “Refund the buyer” on the order page.
        </li>
      </ul>
    </>
  ),

  'kak-prodat': (c, t) => (
    <>
      <ol className="help-steps">
        <li>
          <b>Create a listing.</b> “Sell” → game and category → title, description, category
          parameters, price and photos. The form shows the fee and how much you’ll receive right
          away.
        </li>
        <li>
          <b>Sell currency by quantity.</b> In currency categories the price is set per the
          category’s pack, for example per 1,000 gold, and the buyer chooses how much to buy. That
          way prices in the category are comparable.
        </li>
        <li>
          <b>Auto-delivery from stock.</b> Keys — and, if you like, logins and passwords, promo
          codes or links for accounts and items: one per line. The buyer gets their line right after
          payment; duplicates aren’t added to the stock. When the stock runs out, the listing is
          taken off sale until you restock it.
        </li>
        <li>
          <b>Got an order — deliver the goods.</b> The counter in the header and a notification will
          tell you. Hand over the goods in the order chat and press “Mark as delivered” — you have{' '}
          {hours(c.fulfillHours)}. Set the instructions the buyer receives right after payment in
          the listing form: “Message to the buyer after payment”.
        </li>
        <li>
          <b>Get paid.</b> The money arrives on your balance when the buyer confirms receipt or the
          check period ends. From the balance you can withdraw to a card, via SBP, to YooMoney or in
          USDT.
        </li>
      </ol>
      <h2>How to sell more</h2>
      <ul>
        <li>
          “Raise” in “My listings” moves a listing up in its category. Free, once every{' '}
          {hours(bumpCooldownHours(0))}; from 10 sales — once every {hours(bumpCooldownHours(10))},
          from 50 — once every {hours(bumpCooldownHours(50))}.
        </li>
        <li>
          <Link href="/cabinet/tools">“Tools”</Link> in your account: auto-raise raises listings as
          soon as the pause is over; a greeting for new buyers, marked as an auto-reply; reply
          templates for chat. No third-party bots with access to your account.
        </li>
        <li>
          Promotion — {formatPrice(c.promoDay, 'RUB', t)} per day, packages of{' '}
          {listEn(PROMO_DAYS.map(String))} days, paid from your balance. Buyers see a “promoted”
          label.
        </li>
        <li>
          Reply quickly: buyers see whether you’re online and write from the chat on the listing
          page.
        </li>
        <li>
          Going away — “Vacation” in “My listings” takes all your listings off sale at once and
          brings them back with one button.
        </li>
      </ul>
      <p>
        What the marketplace charges and how to lower the fee — see{' '}
        <Link href="/pomosch/komissii">“Fees and seller levels”</Link>.
      </p>
    </>
  ),

  komissii: (c, t) => (
    <>
      <h2>Fee per sale</h2>
      <p>
        {feeRange(c)} of the price, depending on the category. The buyer pays the listing price and
        the fee is deducted from it. The listing form shows the exact amount you’ll receive before
        publishing.
      </p>
      <h2>Levels</h2>
      <div className="help-table-wrap">
        <table className="help-table">
          <thead>
            <tr>
              <th>Level</th>
              <th>How to get it</th>
              <th>Fee discount</th>
              <th>Order check</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t.d(SELLER_LEVELS.new.label)}</td>
              <td data-label="How to get it">right away</td>
              <td data-label="Discount">—</td>
              <td data-label="Check">{levelHours(c, 'new')}</td>
            </tr>
            <tr>
              <td>{t.d(SELLER_LEVELS.trusted.label)}</td>
              <td data-label="How to get it">
                {LEVEL_RULES.trusted.salesCount}+ sales and a rating of{' '}
                {rating(LEVEL_RULES.trusted.ratingAvg)}+
              </td>
              <td data-label="Discount">{pp(SELLER_LEVELS.trusted.feeDiscountBps)}</td>
              <td data-label="Check">{levelHours(c, 'trusted')}</td>
            </tr>
            <tr>
              <td>{t.d(SELLER_LEVELS.pro.label)}</td>
              <td data-label="How to get it">
                ID verified, {LEVEL_RULES.pro.salesCount}+ sales, {LEVEL_RULES.pro.ratingCount}+
                reviews and a rating of {rating(LEVEL_RULES.pro.ratingAvg)}+
              </td>
              <td data-label="Discount">{pp(SELLER_LEVELS.pro.feeDiscountBps)}</td>
              <td data-label="Check">{levelHours(c, 'pro')}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>The shorter the check, the sooner the money for a sale reaches your balance.</p>
      <h2>Withdrawals</h2>
      <div className="help-table-wrap">
        <table className="help-table">
          <thead>
            <tr>
              <th>Method</th>
              <th>Fee</th>
              <th>Minimum</th>
            </tr>
          </thead>
          <tbody>
            {WITHDRAWAL_METHODS.map((m) => (
              <tr key={m.key}>
                <td>{t.d(m.label)}</td>
                <td data-label="Fee">{fee(m, t)}</td>
                <td data-label="Minimum" style={{ whiteSpace: 'nowrap' }}>
                  {formatPrice(m.minAmount.toString(), 'RUB', t)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  ),

  'oplata-i-vyvod': (c, t) => (
    <>
      <h2>Payment methods</h2>
      <ul>
        <li>{cap(methodsWhere(false, c))} — no surcharge;</li>
        <li>
          {methodsWhere(true, c)} — plus {surcharge}.
        </li>
      </ul>
      <p>
        The surcharge goes to the payment system, not to the marketplace. The total for each method
        is shown before you pay.
      </p>
      {c.demo && (
        <p className="help-note">
          Payments aren’t connected on the demo site: payment is simulated and no money is charged.
        </p>
      )}
      <h2>Balance</h2>
      <ul>
        <li>Refunds and {pct(c.cashback)} cashback after an order is confirmed arrive here.</li>
        <li>For sellers — the money from sales.</li>
        <li>
          You can pay for a purchase or a listing promotion from your balance. Top it up in “Wallet”
          in your account.
        </li>
      </ul>
      <h2>Withdrawals</h2>
      <p>
        “Wallet” in your account → method and amount. Fees and minimum amounts — see{' '}
        <Link href="/pomosch/komissii">“Fees and seller levels”</Link>.
      </p>
      <ul>
        <li>
          Withdrawals above {formatPrice(c.kycAbove, 'RUB', t)} at a time — only after ID
          verification: “Security” → “ID verification”, a photo of your document and a selfie with
          it. The decision will come as a notification.
        </li>
        <li>
          If you haven’t made any sales yet, a withdrawal waits {days(c.newbieHoldDays)} — this is
          how the marketplace protects against money laundering through top-ups.
        </li>
        <li>
          The request’s status is under the withdrawal form: being checked, being sent, paid out. If
          the transfer doesn’t go through, the money returns to your balance.
        </li>
        <li>
          A balance statement for any period is under the withdrawal form, along with files for
          Excel: the statement and your sales with the fee and the amount credited to you.
        </li>
      </ul>
    </>
  ),

  bezopasnost: () => (
    <ul className="help-rules">
      <li>
        <b>Pay only on the site.</b> Escrow protection works only here. If someone asks you to pay
        them directly or move to a messenger, it’s a scam: press “Report”. Phone numbers, usernames
        and links in the chat are hidden automatically.
      </li>
      <li>
        <b>Check before confirming.</b> After “Confirm receipt” the money goes to the seller and a
        dispute can no longer be opened.
      </li>
      <li>
        <b>Bought an account — change the password and email right away.</b> Link your own email and
        turn on sign-in protection in the game’s settings.
      </li>
      <li>
        <b>Look at the seller.</b> Level, reviews with deal amounts, number of sales, “ID verified”
        — in the seller card on the listing and in their profile.
      </li>
      <li>
        <b>Staff never ask for passwords or codes.</b> Neither in chat nor by email.
      </li>
      <li>
        <b>Keep an eye on sign-ins.</b> In your account, under “Security”, you can see where your
        account was signed in from and end all sessions except the current one.
      </li>
      <li>
        <b>Sign in with Telegram, VK ID or Google</b> — if the buttons are shown under the sign-in
        form. Connect or disconnect a service in the same place, under “Security”. The authenticator
        code is asked for with this kind of sign-in too.
      </li>
      <li>
        <b>Don’t want to deal with someone</b> — use “Add to blacklist” on their page: they won’t be
        able to message you before a deal or buy your listings.
      </li>
    </ul>
  ),

  prilozhenie: () => (
    <>
      <p>
        There’s nothing to download: the site installs on your phone and opens like an app — with
        its own icon and no address bar.
      </p>
      <h2>Android</h2>
      <ol>
        <li>Open the site in Chrome.</li>
        <li>
          Press “Install app” at the bottom of the site or in the ⋮ menu — “Install app” (“Add to
          Home screen”).
        </li>
      </ol>
      <h2>iPhone and iPad</h2>
      <ol>
        <li>Open the site in Safari.</li>
        <li>Press “Share” and choose “Add to Home Screen”.</li>
      </ol>
      <h2>Computer</h2>
      <p>
        In Chrome and Edge — the install icon in the address bar or “Install app” at the bottom of
        the site.
      </p>
      <h2>What else</h2>
      <ul>
        <li>A long press on the icon on Android opens “Messages”, “Orders” and “My listings”.</li>
        <li>
          Push notifications about orders and messages appear on your phone screen even when the
          site is closed: “Settings” → “Notifications” → “Turn on for this device”. On iPhone —
          after adding the site to the Home Screen.
        </li>
        <li>
          Without internet you’ll see a “No connection” page, and when the connection is back — the
          page you need.
        </li>
      </ul>
    </>
  ),
};
