/**
 * Тестовый сервер ЮKassa для e2e: ведёт себя как API v3. Проверяет то же,
 * что настоящий: ключи магазина (Basic), ключ идемпотентности, сумму в
 * рублях строкой, переход со страницы оплаты на return_url. Оплату
 * «совершает» сценарий: mock.settle(id, 'succeeded') меняет статус и шлёт
 * уведомление на вебхук магазина — без подписи, как настоящая ЮKassa.
 *
 * API для e2e запускается с YOOKASSA_API_URL, указывающим сюда (только вне
 * прода).
 */
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

export function startYooKassaMock(base, { shopId, secretKey }) {
  const payments = new Map();
  const byKey = new Map();
  const origin = new URL(base).origin;
  const auth = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;
  let webhook = null;

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
        settle,
        /** Адрес вебхука магазина, куда слать уведомления. */
        notifyTo: (url) => (webhook = url),
        close: () => server.close(),
      }),
    );
  });
}
