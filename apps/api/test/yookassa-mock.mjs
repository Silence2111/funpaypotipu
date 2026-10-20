/**
 * Тестовый сервер ЮKassa для e2e: ведёт себя как API v3. Проверяет то же,
 * что настоящий: ключи магазина (Basic), ключ идемпотентности, сумму в
 * рублях строкой, переход со страницы оплаты на return_url. Оплату
 * «совершает» сценарий: mock.settle(id, 'succeeded') меняет статус и шлёт
 * уведомление на вебхук магазина — без подписи, как настоящая ЮKassa.
 * Выплаты — свои ключи агента, телефон и банк СБП, кошелёк ЮMoney;
 * итог — mock.settlePayout(id, 'succeeded' | 'canceled').
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

export function startYooKassaMock(
  base,
  { shopId, secretKey, agentId = 'e2e-agent', agentSecret = 'e2e-agent-secret' },
) {
  const payments = new Map();
  const payouts = new Map();
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

  /** Статус платежа и уведомление магазину; amount — подменить сумму (проверка сверки). */
  async function settle(id, status, opts = {}) {
    const p = payments.get(id);
    if (!p) throw new Error(`нет платежа ${id}`);
    p.status = status;
    p.paid = status === 'succeeded';
    if (opts.amount) p.amount = { ...p.amount, value: opts.amount };
    if (!webhook) return null;
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'notification', event: `payment.${status}`, object: p }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
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
    const d = body?.payout_destination_data;
    const destOk =
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

    // Страница оплаты: «покупатель заплатил» → уведомление → назад в магазин.
    if (parts[0] === 'checkout' && req.method === 'GET') {
      const p = payments.get(parts[1]);
      if (!p) return send(res, 404, { type: 'error', code: 'not_found' });
      await settle(p.id, url.searchParams.get('result') === 'canceled' ? 'canceled' : 'succeeded');
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
        body.capture === true &&
        body.confirmation?.type === 'redirect' &&
        /^https?:\/\//.test(body.confirmation.return_url ?? '') &&
        typeof body.metadata?.providerRef === 'string';
      if (!ok) return send(res, 400, { type: 'error', code: 'invalid_request' });
      const id = `yk-${randomBytes(8).toString('hex')}`;
      const payment = {
        id,
        status: 'pending',
        paid: false,
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
    return send(res, 405, { type: 'error', code: 'method_not_allowed' });
  });

  return new Promise((resolve) => {
    server.listen(Number(new URL(base).port), () =>
      resolve({
        payments,
        payouts,
        settle,
        settlePayout,
        /** Адрес вебхука магазина, куда слать уведомления. */
        notifyTo: (url) => (webhook = url),
        /** Адрес вебхука выплат. */
        notifyPayoutsTo: (url) => (payoutWebhook = url),
        close: () => server.close(),
      }),
    );
  });
}
