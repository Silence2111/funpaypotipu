/**
 * Тестовый сервер ЮKassa для e2e: ведёт себя как API v3. Проверяет то же,
 * что настоящий: ключи магазина (Basic), ключ идемпотентности, сумму в
 * рублях строкой, переход со страницы оплаты на return_url. Оплату
 * «совершает» сценарий: mock.settle(id, 'succeeded') меняет статус и шлёт
 * уведомление на вебхук магазина — без подписи, как настоящая ЮKassa.
 * Картой платят на /checkout/<id>?card=<номер> (по умолчанию тестовая
 * •••• 4477): у платежа появляется payment_method.card без номера. Платёж
 * в две стадии (capture: false) после оплаты ждёт подтверждения, отмена —
 * POST /v3/payments/<id>/cancel.
 * Выплаты — свои ключи агента, телефон и банк СБП, кошелёк ЮMoney, карта
 * токеном из виджета; итог — mock.settlePayout(id, 'succeeded' | 'canceled').
 * Виджет карты — /payouts-data/widget.js: тот же класс PayoutsData, что у
 * ЮKassa, но с простым полем номера; в e2e карту превращает в токен
 * mock.tokenizeCard(номер).
 *
 * API для e2e запускается с YOOKASSA_API_URL, указывающим сюда (только вне
 * прода).
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export const SBP_BANKS = [
  { bank_id: '100000000111', name: 'Сбербанк', bic: '044525225' },
  { bank_id: '100000000004', name: 'Т-Банк', bic: '044525974' },
];

/** Номер карты по Луну — как проверяет настоящий виджет. */
const luhn = (num) =>
  [...num].reverse().reduce((sum, ch, i) => {
    let d = Number(ch);
    if (i % 2) d = d * 2 > 9 ? d * 2 - 9 : d * 2;
    return sum + d;
  }, 0) %
    10 ===
  0;

/** Тестовый виджет: класс PayoutsData с методами render и clearListeners. */
const WIDGET_JS = (origin) => `(() => {
  class PayoutsData {
    constructor(o) { this.o = o; }
    render(id) {
      const box = document.getElementById(id);
      if (!box) return Promise.reject(new Error('нет контейнера ' + id));
      box.innerHTML = '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<input data-yk-card inputmode="numeric" autocomplete="cc-number" placeholder="Номер карты" ' +
        'style="font:inherit;font-size:16px;padding:10px 12px;border:1px solid #ECECF2;border-radius:12px;min-width:0;flex:1 1 180px">' +
        '<button type="button" data-yk-go style="font:inherit;padding:10px 14px;border:1px solid #ECECF2;border-radius:12px;background:#fff;cursor:pointer">Продолжить</button></div>';
      box.querySelector('[data-yk-go]').onclick = async () => {
        const number = box.querySelector('[data-yk-card]').value.replace(/\\D/g, '');
        try {
          const r = await fetch('${origin}/payouts-data/tokenize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: this.o.account_id, number }),
          });
          const data = await r.json();
          if (!r.ok) throw data;
          this.o.success_callback && this.o.success_callback(data);
        } catch (e) {
          this.o.error_callback && this.o.error_callback(e);
        }
      };
      return Promise.resolve();
    }
    clearListeners() { this.o = {}; }
  }
  window.PayoutsData = PayoutsData;
})();`;

export function startYooKassaMock(
  base,
  { shopId, secretKey, agentId = 'e2e-agent', agentSecret = 'e2e-agent-secret' },
) {
  const payments = new Map();
  const payouts = new Map();
  const cards = new Map();
  const byKey = new Map();
  const origin = new URL(base).origin;
  const basic = (id, secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  const auth = basic(shopId, secretKey);
  const payoutAuth = basic(agentId, agentSecret);
  let webhook = null;
  let payoutWebhook = null;

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const json = (req) =>
    new Promise((done) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        try {
          done(JSON.parse(raw));
        } catch {
          done(null);
        }
      });
    });

  /** Карта платежа так, как её отдаёт ЮKassa: без номера. */
  const cardOf = (number) => ({
    first6: number.slice(0, 6),
    last4: number.slice(-4),
    expiry_month: '12',
    expiry_year: '2030',
    card_type: number.startsWith('4') ? 'Visa' : number.startsWith('2') ? 'Mir' : 'MasterCard',
    issuer_country: 'RU',
  });

  /**
   * Статус платежа и уведомление магазину; amount — подменить сумму (проверка
   * сверки), card — номер карты, которой заплатили.
   */
  async function settle(id, status, opts = {}) {
    const p = payments.get(id);
    if (!p) throw new Error(`нет платежа ${id}`);
    p.status = status;
    p.paid = status === 'succeeded' || status === 'waiting_for_capture';
    if (opts.amount) p.amount = { ...p.amount, value: opts.amount };
    // Карта — при оплате; отмена после оплаты карту не меняет.
    if (p.payment_method_data?.type === 'bank_card' && (opts.card || !p.payment_method)) {
      p.payment_method = {
        type: 'bank_card',
        id: p.id,
        saved: false,
        card: cardOf(opts.card ?? '5555555555554477'),
      };
    }
    if (!webhook) return null;
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'notification', event: `payment.${status}`, object: p }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Карта → токен, как делает виджет; null — номер не прошёл проверку. */
  function tokenizeCard(number) {
    if (!/^\d{16,19}$/.test(number) || !luhn(number)) return null;
    const card = {
      payout_token: `pt-${randomBytes(12).toString('hex')}`,
      first6: number.slice(0, 6),
      last4: number.slice(-4),
      card_type: number.startsWith('4') ? 'Visa' : number.startsWith('2') ? 'Mir' : 'MasterCard',
      issuer_country: 'RU',
      issuer_name: 'Тестовый банк',
    };
    cards.set(card.payout_token, card);
    return card;
  }

  /** Итог выплаты и уведомление агенту выплат. */
  async function settlePayout(id, status, opts = {}) {
    const p = payouts.get(id);
    if (!p) throw new Error(`нет выплаты ${id}`);
    p.status = status;
    if (status === 'canceled') {
      p.cancellation_details = { party: 'yoo_money', reason: opts.reason ?? 'rejected_by_payee' };
    }
    if (opts.amount) p.amount = { ...p.amount, value: opts.amount };
    if (!payoutWebhook) return null;
    const res = await fetch(payoutWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'notification', event: `payout.${status}`, object: p }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  /** Выплаты: свои ключи агента, получатель — СБП (телефон и банк) или ЮMoney. */
  async function payoutsApi(req, res, parts) {
    if (req.headers.authorization !== payoutAuth) {
      return send(res, 401, { type: 'error', code: 'invalid_credentials' });
    }
    if (parts[1] === 'sbp_banks' && req.method === 'GET')
      return send(res, 200, { type: 'list', items: SBP_BANKS });
    if (req.method === 'GET' && parts.length === 3) {
      const p = payouts.get(parts[2]);
      return p ? send(res, 200, p) : send(res, 404, { type: 'error', code: 'not_found' });
    }
    if (req.method !== 'POST' || parts.length !== 2) {
      return send(res, 405, { type: 'error', code: 'method_not_allowed' });
    }
    const key = req.headers['idempotence-key'];
    if (!key)
      return send(res, 400, {
        type: 'error',
        code: 'invalid_request',
        parameter: 'Idempotence-Key',
      });
    if (byKey.has(`po:${key}`)) return send(res, 200, payouts.get(byKey.get(`po:${key}`)));
    const body = await json(req);
    const card = cards.get(body?.payout_token);
    const d = card
      ? { type: 'bank_card', card: { ...card, payout_token: undefined } }
      : body?.payout_destination_data;
    const destOk =
      !!card ||
      (d?.type === 'sbp' &&
        /^7\d{10}$/.test(d.phone ?? '') &&
        SBP_BANKS.some((b) => b.bank_id === d.bank_id)) ||
      (d?.type === 'yoo_money' && /^\d{11,20}$/.test(d.account_number ?? ''));
    if (
      !body ||
      !/^\d+\.\d{2}$/.test(body.amount?.value ?? '') ||
      body.amount.currency !== 'RUB' ||
      !destOk
    ) {
      return send(res, 400, { type: 'error', code: 'invalid_request' });
    }
    const id = `po-${randomBytes(8).toString('hex')}`;
    const payout = {
      id,
      status: 'pending',
      amount: body.amount,
      payout_destination: d,
      description: body.description,
      metadata: body.metadata,
      created_at: new Date().toISOString(),
    };
    payouts.set(id, payout);
    byKey.set(`po:${key}`, id);
    return send(res, 200, payout);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    const parts = url.pathname.split('/').filter(Boolean);

    // Виджет карты: скрипт и превращение номера в токен (ключ — id шлюза).
    if (parts[0] === 'payouts-data') {
      const cors = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        return res.end();
      }
      if (parts[1] === 'widget.js') {
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', ...cors });
        return res.end(WIDGET_JS(origin));
      }
      if (parts[1] === 'tokenize' && req.method === 'POST') {
        const body = await json(req);
        const card = body?.account_id === agentId ? tokenizeCard(String(body.number ?? '')) : null;
        return card
          ? send(res, 200, card, cors)
          : send(res, 400, { error: 'invalid_card_number' }, cors);
      }
      return send(res, 404, { type: 'error', code: 'not_found' }, cors);
    }

    // Страница оплаты: «покупатель заплатил» → уведомление → назад в магазин.
    if (parts[0] === 'checkout' && req.method === 'GET') {
      const p = payments.get(parts[1]);
      if (!p) return send(res, 404, { type: 'error', code: 'not_found' });
      const paidStatus = p.capture === false ? 'waiting_for_capture' : 'succeeded';
      await settle(p.id, url.searchParams.get('result') === 'canceled' ? 'canceled' : paidStatus, {
        card: url.searchParams.get('card') ?? undefined,
      });
      res.writeHead(302, { Location: p.confirmation.return_url });
      return res.end();
    }

    if (parts[0] === 'v3' && (parts[1] === 'payouts' || parts[1] === 'sbp_banks'))
      return payoutsApi(req, res, parts);
    if (parts[0] !== 'v3' || parts[1] !== 'payments')
      return send(res, 404, { type: 'error', code: 'not_found' });
    if (req.headers.authorization !== auth)
      return send(res, 401, { type: 'error', code: 'invalid_credentials' });

    if (req.method === 'POST' && parts.length === 2) {
      const key = req.headers['idempotence-key'];
      if (!key)
        return send(res, 400, {
          type: 'error',
          code: 'invalid_request',
          parameter: 'Idempotence-Key',
        });
      if (byKey.has(key)) return send(res, 200, payments.get(byKey.get(key)));
      const body = await json(req);
      const ok =
        body &&
        /^\d+\.\d{2}$/.test(body.amount?.value ?? '') &&
        body.amount.currency === 'RUB' &&
        typeof body.capture === 'boolean' &&
        body.confirmation?.type === 'redirect' &&
        /^https?:\/\//.test(body.confirmation.return_url ?? '') &&
        (typeof body.metadata?.providerRef === 'string' || body.capture === false);
      if (!ok) return send(res, 400, { type: 'error', code: 'invalid_request' });
      const id = `yk-${randomBytes(8).toString('hex')}`;
      const payment = {
        id,
        status: 'pending',
        paid: false,
        capture: body.capture,
        amount: body.amount,
        description: body.description,
        metadata: body.metadata,
        payment_method_data: body.payment_method_data,
        receipt: body.receipt,
        confirmation: {
          type: 'redirect',
          confirmation_url: `${origin}/checkout/${id}`,
          return_url: body.confirmation.return_url,
        },
        created_at: new Date().toISOString(),
      };
      payments.set(id, payment);
      byKey.set(key, id);
      return send(res, 200, payment);
    }

    if (req.method === 'GET' && parts.length === 3) {
      const p = payments.get(parts[2]);
      return p ? send(res, 200, p) : send(res, 404, { type: 'error', code: 'not_found' });
    }

    // Отмена платежа, ждущего подтверждения: блокировка на карте снимается.
    if (req.method === 'POST' && parts.length === 4 && parts[3] === 'cancel') {
      const p = payments.get(parts[2]);
      if (!p) return send(res, 404, { type: 'error', code: 'not_found' });
      if (!req.headers['idempotence-key'])
        return send(res, 400, {
          type: 'error',
          code: 'invalid_request',
          parameter: 'Idempotence-Key',
        });
      if (p.status === 'canceled') return send(res, 200, p);
      if (p.status !== 'waiting_for_capture')
        return send(res, 400, { type: 'error', code: 'invalid_request' });
      p.cancelled_by_shop = true;
      await settle(p.id, 'canceled');
      return send(res, 200, p);
    }
    return send(res, 405, { type: 'error', code: 'method_not_allowed' });
  });

  return new Promise((resolve) => {
    server.listen(Number(new URL(base).port), () =>
      resolve({
        payments,
        payouts,
        settle,
        settlePayout,
        tokenizeCard,
        /** Адрес вебхука магазина, куда слать уведомления. */
        notifyTo: (url) => (webhook = url),
        /** Адрес вебхука выплат. */
        notifyPayoutsTo: (url) => (payoutWebhook = url),
        close: () => server.close(),
      }),
    );
  });
}
