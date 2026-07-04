/**
 * Сквозные e2e-тесты денежных путей против запущенного API + БД.
 * Запуск: API_URL=http://localhost:4090 DATABASE_URL=... node apps/api/test/e2e.mjs
 * Покрывает: эскроу-покупка, авто-выдача ключей, выплаты (с холдом и ролью finance).
 * Выход 0 — все проверки пройдены, иначе 1.
 */
import db from '../../../packages/db/dist/index.js';

const { prisma } = db;
const API = process.env.API_URL ?? 'http://localhost:4090';

const results = [];
function check(name, cond, detail = '') {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  const res = await fetch(`${API}/api${path}`, { method: opts.method || 'GET', headers, body: opts.body });
  const t = await res.text();
  let b;
  try { b = JSON.parse(t); } catch { b = t; }
  return { status: res.status, body: b };
}

async function register(prefix, rnd) {
  const r = await j('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: `${prefix}${rnd}@e2e.local`, password: 'password123', username: `${prefix}${rnd}` }),
  });
  return { token: r.body.accessToken, id: r.body.user?.id, status: r.status };
}

async function createListing(token, categorySlug, price) {
  const game = await j('/catalog/games/cs2');
  const cat = game.body.categories.find((c) => c.slug === categorySlug);
  const l = await j('/listings', {
    method: 'POST', token,
    body: JSON.stringify({ gameId: game.body.id, categoryId: cat.id, title: `E2E ${categorySlug}`, description: 'test', price, currency: 'RUB' }),
  });
  return l.body.id;
}

async function pay(token, orderId) {
  const dep = await j('/payments/deposit', { method: 'POST', token, body: JSON.stringify({ orderId }) });
  await j('/payments/mock/callback?providerRef=' + dep.body.providerRef, { method: 'POST' });
}

async function scenarioEscrow(rnd) {
  console.log('\n— Эскроу-покупка (ручная выдача) —');
  const seller = await register('ess', rnd);
  const buyer = await register('esb', rnd);
  const listingId = await createListing(seller.token, 'accounts', '150000');
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  check('Заказ создан, комиссия 150000/135000', order.body.amount === '150000' && order.body.sellerPayoutAmount === '135000');
  await pay(buyer.token, order.body.id);
  const w0 = await j('/wallet', { token: seller.token });
  check('Эскроу держит: баланс продавца 0', w0.body.balance === '0');
  await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
  const conf = await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });
  check('Подтверждение → completed', conf.body.status === 'completed');
  const w1 = await j('/wallet', { token: seller.token });
  check('Релиз: баланс продавца 135000', w1.body.balance === '135000', w1.body.balance);
  const rev = await j('/reviews', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, rating: 5 }) });
  check('Отзыв создан', rev.status === 201);
  const dup = await j('/reviews', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, rating: 4 }) });
  check('Повторный отзыв → 409', dup.status === 409);
}

async function scenarioAutoKey(rnd) {
  console.log('\n— Авто-выдача ключей —');
  const seller = await register('kys', rnd);
  const buyer = await register('kyb', rnd);
  const listingId = await createListing(seller.token, 'keys', '50000');
  const add = await j(`/listings/${listingId}/keys`, { method: 'POST', token: seller.token, body: JSON.stringify({ keys: ['STEAM-AAA-BBB', 'STEAM-CCC-DDD'] }) });
  check('Ключи на складе (2)', add.body.added === 2);
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  await pay(buyer.token, order.body.id);
  const o = await j(`/orders/${order.body.id}`, { token: buyer.token });
  check('Авто-выдача → delivered', o.body.status === 'delivered');
  const key = await j(`/orders/${order.body.id}/key`, { token: buyer.token });
  check('Ключ расшифрован покупателю', /^STEAM-/.test(key.body.key || ''));
}

async function scenarioPayout(rnd) {
  console.log('\n— Выплаты (finance) —');
  const seller = await register('pys', rnd);
  const buyer = await register('pyb', rnd);
  const listingId = await createListing(seller.token, 'accounts', '150000');
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  await pay(buyer.token, order.body.id);
  await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
  await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });

  const fin = await register('pyf', rnd);
  const role = await prisma.role.findUnique({ where: { key: 'finance' } });
  await prisma.userRole.upsert({ where: { userId_roleId: { userId: fin.id, roleId: role.id } }, update: {}, create: { userId: fin.id, roleId: role.id } });

  const over = await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '999999', method: 'card', destination: '4111111111111111' }) });
  check('Вывод больше баланса → 400', over.status === 400);
  const req = await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '100000', method: 'card', destination: '4111111111111111' }) });
  check('Заявка создана (requested)', req.body.status === 'requested');
  const wHold = await j('/wallet', { token: seller.token });
  check('Резерв: баланс 35000', wHold.body.balance === '35000', wHold.body.balance);
  const noAccess = await j(`/payouts/${req.body.id}/approve`, { method: 'POST', token: seller.token });
  check('Продавец не одобряет свою выплату → 403', noAccess.status === 403);
  const appr = await j(`/payouts/${req.body.id}/approve`, { method: 'POST', token: fin.token });
  check('Finance одобрил → paid', appr.body.status === 'paid');
}

(async () => {
  const rnd = Math.floor(Math.random() * 1e9);
  // ждём готовности API
  for (let i = 0; i < 30; i++) {
    const h = await j('/health').catch(() => ({ status: 0 }));
    if (h.status === 200) break;
    await wait(500);
  }
  await scenarioEscrow(rnd);
  await scenarioAutoKey(rnd);
  await scenarioPayout(rnd);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== E2E: ${passed}/${results.length} проверок пройдено ===`);
  await prisma.$disconnect().catch(() => {});
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error('E2E FAIL', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
