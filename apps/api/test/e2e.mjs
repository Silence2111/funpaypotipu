/**
 * Сквозные e2e-тесты денежных путей против запущенного API + БД.
 * Запуск: API_URL=http://localhost:4090 DATABASE_URL=... node apps/api/test/e2e.mjs
 * Покрывает: эскроу-покупка, авто-выдача ключей, пополнение на сумму покупателя,
 * продажа поштучно (наличие, перепродажа последней штуки), способы оплаты (надбавка карты,
 * второй платёж по заказу), модерация (жалобы, бан, заморозка, спор у арбитра),
 * выплаты (с холдом и ролью finance).
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

// Обязательные характеристики категорий из сида: без них API отвечает 400
// «Укажите характеристику …», и все проверки после создания лота краснеют.
const REQUIRED_ATTRS = {
  accounts: { rank: 'Global Elite', region: 'EU' },
  skins: { rarity: 'Covert' },
  keys: { region: 'Global' },
};

async function createListing(token, categorySlug, price, extra = {}) {
  const game = await j('/catalog/games/cs2');
  const cat = game.body.categories.find((c) => c.slug === categorySlug);
  const l = await j('/listings', {
    method: 'POST', token,
    body: JSON.stringify({
      gameId: game.body.id, categoryId: cat.id, title: `E2E ${categorySlug}`, description: 'test', price, currency: 'RUB',
      attributes: REQUIRED_ATTRS[categorySlug] ?? {},
      ...extra,
    }),
  });
  if (l.status !== 201) throw new Error(`Лот не создан (${l.status}): ${JSON.stringify(l.body)}`);
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

async function scenarioSteamTopup(rnd) {
  console.log('\n— Пополнение Steam на сумму покупателя —');
  const seller = await register('tps', rnd);
  const buyer = await register('tpb', rnd);
  const steam = await j('/catalog/games/steam');
  const cat = steam.body.categories?.find((c) => c.slug === 'topup');
  const lot = await j('/listings', {
    method: 'POST', token: seller.token,
    body: JSON.stringify({
      gameId: steam.body.id, categoryId: cat?.id, title: `E2E Steam ${rnd}`, description: 'test',
      price: '1', currency: 'RUB', topup: { markupBps: 800, min: '10000', max: '1500000' },
    }),
  });
  // Переданная цена игнорируется: у такого лота она следует из условий («от 108 ₽»).
  check('Лот на сумму покупателя: цена «от» считается сервером', lot.status === 201 && lot.body.price === '10800', lot.body.price);
  const offers = await j('/topup/offers?game=steam');
  check('Лот виден виджету пополнения', offers.body.offers?.some((o) => o.listingId === lot.body.id));

  const tooSmall = await j('/orders', {
    method: 'POST', token: buyer.token,
    body: JSON.stringify({ listingId: lot.body.id, account: 'e2e_login', topupAmount: '5000' }),
  });
  check('Сумма ниже минимума → 400', tooSmall.status === 400);
  const email = await j('/orders', {
    method: 'POST', token: buyer.token,
    body: JSON.stringify({ listingId: lot.body.id, account: 'buyer@mail.ru', topupAmount: '100000' }),
  });
  check('Почта вместо логина Steam → 400 до оплаты', email.status === 400);

  const order = await j('/orders', {
    method: 'POST', token: buyer.token,
    body: JSON.stringify({ listingId: lot.body.id, account: 'e2e_login', topupAmount: '100000' }),
  });
  check('1 000 ₽ на Steam стоят 1 080 ₽', order.body.amount === '108000', order.body.amount);
  await pay(buyer.token, order.body.id);
  const o = await j(`/orders/${order.body.id}`, { token: buyer.token });
  check('Пополнение выдано сразу после оплаты', o.body.status === 'delivered', o.body.status);
  check('В заказе номинал 1 000 ₽ — его зачисляет провайдер', o.body.listingSnapshot?.topupAmount === '100000');
  const delivery = await prisma.delivery.findUnique({ where: { orderId: order.body.id } });
  check('Провайдер вернул номер операции', !!delivery?.providerRef);

  await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });
  const w = await j('/wallet', { token: seller.token });
  check('Продавец получил цену минус 10%: 972 ₽', w.body.balance === '97200', w.body.balance);
}

async function scenarioQuantity(rnd) {
  console.log('\n— Продажа поштучно —');
  const seller = await register('qts', rnd);
  const [b1, b2, b3] = [await register('qb1', rnd), await register('qb2', rnd), await register('qb3', rnd)];
  // 120 ₽ за штуку, от 2 штук, в наличии 5
  const lotId = await createListing(seller.token, 'skins', '12000', { unitName: 'шт.', pricePerUnits: 1, minQty: 2, stock: 5 });
  const order = (token, qty) => j('/orders', { method: 'POST', token, body: JSON.stringify({ listingId: lotId, qty }) });
  const stock = async () => (await prisma.listing.findUnique({ where: { id: lotId }, select: { stock: true, status: true } }));

  check('Меньше минимума → 400', (await order(b1.token, 1)).status === 400);
  check('Больше наличия → 400', (await order(b1.token, 6)).status === 400);
  const o1 = await order(b1.token, 3);
  check('3 шт. по 120 ₽ — заказ на 360 ₽', o1.body.amount === '36000' && o1.body.qty === 3, o1.body.amount);
  check('Неоплаченный заказ наличие не держит', (await stock()).stock === 5);
  await pay(b1.token, o1.body.id);
  check('Оплата списала 3 шт.: осталось 2', (await stock()).stock === 2);

  // Два покупателя на последние 2 штуки: заказ создают оба, оплата достаётся первому.
  const o2 = await order(b2.token, 2);
  const o3 = await order(b3.token, 2);
  await pay(b2.token, o2.body.id);
  const after = await stock();
  check('Последние штуки проданы — лот закончился', after.stock === 0 && after.status === 'sold_out', JSON.stringify(after));
  await pay(b3.token, o3.body.id);
  const late = await j(`/orders/${o3.body.id}`, { token: b3.token });
  check('Опоздавшему деньги вернулись сразу', late.body.status === 'refunded', late.body.status);
  const w3 = await j('/wallet', { token: b3.token });
  check('Возврат на баланс: 240 ₽', w3.body.balance === '24000', w3.body.balance);
  const page = await j(`/listings/${lotId}`);
  check('Закончившийся лот открывается по ссылке', page.status === 200 && page.body.status === 'sold_out');
  check('Закончившийся лот не купить', (await order(b1.token, 2)).status === 400);

  await j(`/orders/${o1.body.id}/cancel`, { method: 'POST', token: b1.token });
  const back = await stock();
  check('Отмена до выдачи вернула 3 шт., лот снова в продаже', back.stock === 3 && back.status === 'active', JSON.stringify(back));

  // Ключи: лот без ключей в каталог не выходит, несколько ключей в одном заказе.
  const keysLot = await createListing(seller.token, 'keys', '4900');
  const empty = await prisma.listing.findUnique({ where: { id: keysLot }, select: { status: true } });
  check('Лот ключей без ключей не в продаже', empty.status === 'sold_out', empty.status);
  await j(`/listings/${keysLot}/keys`, { method: 'POST', token: seller.token, body: JSON.stringify({ keys: ['Q-KEY-1', 'Q-KEY-2', 'Q-KEY-3'] }) });
  const ko = await j('/orders', { method: 'POST', token: b2.token, body: JSON.stringify({ listingId: keysLot, qty: 2 }) });
  check('2 ключа по 49 ₽ — заказ на 98 ₽', ko.body.amount === '9800', ko.body.amount);
  await pay(b2.token, ko.body.id);
  const keys = await j(`/orders/${ko.body.id}/key`, { token: b2.token });
  check('Выданы 2 разных ключа', keys.body.keys?.length === 2 && keys.body.keys[0] !== keys.body.keys[1], JSON.stringify(keys.body));
  const left = await prisma.listing.findUnique({ where: { id: keysLot }, select: { stock: true } });
  check('На складе остался 1 ключ', left.stock === 1, String(left.stock));
}

async function scenarioPaymentMethods(rnd) {
  console.log('\n— Способы оплаты —');
  const seller = await register('pms', rnd);
  const buyer = await register('pmb', rnd);
  const listingId = await createListing(seller.token, 'accounts', '100000');
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  const deposit = (method) =>
    j('/payments/deposit', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, method }) });

  // Покупатель начал платить по СБП, передумал и оплатил картой — и СБП тоже прошёл.
  const sbp = await deposit('sbp');
  const card = await deposit('card');
  check('Картой: 1 000 ₽ + 4,4% = 1 044 ₽', card.body.amount === '104400' && card.body.surcharge === '4400', card.body.amount);
  check('По СБП — ровно сумма заказа', sbp.body.amount === '100000', sbp.body.amount);
  await j('/payments/mock/callback?providerRef=' + card.body.providerRef, { method: 'POST' });
  const paid = await j(`/orders/${order.body.id}`, { token: buyer.token });
  check('Заказ оплачен картой, надбавка записана', paid.body.status === 'paid' && paid.body.paymentMethod === 'card' && paid.body.paymentSurcharge === '4400');
  const fees = await prisma.ledgerEntry.findMany({ where: { orderId: order.body.id, account: { kind: 'fees_payable' } } });
  check('Надбавка — обязательство перед платёжкой, не эскроу', fees.length === 1 && fees[0].amount === 4400n);

  await j('/payments/mock/callback?providerRef=' + sbp.body.providerRef, { method: 'POST' });
  const w = await j('/wallet', { token: buyer.token });
  check('Второй платёж по заказу — на баланс покупателя', w.body.balance === '100000', w.body.balance);
  const again = await j(`/orders/${order.body.id}`, { token: buyer.token });
  check('Заказ не оплачен дважды', again.body.status === 'paid');
  const dup = await j('/payments/mock/callback?providerRef=' + sbp.body.providerRef, { method: 'POST' });
  const w2 = await j('/wallet', { token: buyer.token });
  check('Повтор вебхука не зачисляет второй раз', dup.body.alreadyProcessed === true && w2.body.balance === '100000', w2.body.balance);

  const top = await j('/payments/topup', { method: 'POST', token: buyer.token, body: JSON.stringify({ amount: '50000', method: 'card' }) });
  await j('/payments/mock/callback?providerRef=' + top.body.providerRef, { method: 'POST' });
  const w3 = await j('/wallet', { token: buyer.token });
  check('Пополнение картой: списано 522 ₽, на баланс 500 ₽', top.body.amount === '52200' && w3.body.balance === '150000', `${top.body.amount} / ${w3.body.balance}`);
}

async function grant(userId, roleKey) {
  const role = await prisma.role.findUnique({ where: { key: roleKey } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId: role.id } },
    update: {},
    create: { userId, roleId: role.id },
  });
}

async function scenarioModeration(rnd) {
  console.log('\n— Модерация и споры —');
  const seller = await register('mds', rnd);
  const buyer = await register('mdb', rnd);
  const mod = await register('mdm', rnd);
  const agent = await register('mda', rnd);
  await grant(mod.id, 'moderator');
  await grant(agent.id, 'agent');
  const bad = await createListing(seller.token, 'accounts', '200000');
  const other = await createListing(seller.token, 'accounts', '90000');

  const report = (body) => j('/reports', { method: 'POST', token: buyer.token, body: JSON.stringify(body) });
  const r1 = await report({ targetType: 'listing', targetId: bad, reason: 'Мошенничество', details: 'просит оплату на карту' });
  const r2 = await report({ targetType: 'listing', targetId: bad, reason: 'Мошенничество' });
  check('Жалоба принята, повтор не плодит дубль', r1.status === 201 && r2.body.id === r1.body.id);
  check('Жалоба на несуществующее → 400/404', [400, 404].includes((await report({ targetType: 'listing', targetId: 'nope', reason: 'Другое' })).status));
  check('Покупатель не видит очередь модератора', (await j('/moderation/reports', { token: buyer.token })).status === 403);
  const queue = await j('/moderation/reports', { token: mod.token });
  const item = queue.body.find?.((r) => r.id === r1.body.id);
  check('В очереди видно, на что жалоба', item?.target?.title === 'E2E accounts' && item?.target?.user?.id === seller.id);

  await j(`/moderation/reports/${r1.body.id}/handle`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'resolved', action: 'block_listing' }) });
  check('Лот заблокирован и пропал с витрины', (await j(`/listings/${bad}`)).status === 404);
  const relist = await j(`/listings/${bad}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ status: 'active' }) });
  check('Продавец сам блокировку не снимает', relist.status === 403);

  // Заказ до бана: потом по нему будет спор
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: other }) });
  await pay(buyer.token, order.body.id);

  const ban = await j(`/moderation/users/${seller.id}/status`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'banned', reason: 'мошенничество' }) });
  check('Бан применён', ban.body.status === 'banned');
  check('Выданный до бана токен не работает', (await j('/wallet', { token: seller.token })).status === 401);
  const login = await j('/auth/login', { method: 'POST', body: JSON.stringify({ email: `mds${rnd}@e2e.local`, password: 'password123' }) });
  check('Забаненный не входит', login.status === 403);
  const otherAfterBan = await prisma.listing.findUnique({ where: { id: other }, select: { status: true } });
  check('Лоты забаненного ушли из каталога', otherAfterBan.status === 'paused', otherAfterBan.status);

  await j(`/moderation/users/${seller.id}/status`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'active' }) });
  const restored = await prisma.listing.findMany({ where: { id: { in: [bad, other] } }, select: { id: true, status: true } });
  const st = Object.fromEntries(restored.map((l) => [l.id, l.status]));
  check('Разбан вернул лоты, снятые баном; заблокированный остался', st[other] === 'active' && st[bad] === 'blocked', JSON.stringify(st));

  const touchStaff = await j(`/moderation/users/${agent.id}/status`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'banned' }) });
  check('Модератор не банит арбитра', touchStaff.status === 403);

  await j(`/moderation/users/${buyer.id}/status`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'frozen' }) });
  const frozenBuy = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: other }) });
  check('Замороженный не покупает, но входит', frozenBuy.status === 403 && (await j('/wallet', { token: buyer.token })).status === 200);
  await j(`/moderation/users/${buyer.id}/status`, { method: 'POST', token: mod.token, body: JSON.stringify({ status: 'active' }) });

  const dispute = await j('/disputes', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, reason: 'Продавец пропал после оплаты' }) });
  const dq = await j('/disputes/queue', { token: agent.token });
  const inQueue = dq.body.find?.((d) => d.id === dispute.body.id);
  check('Спор в очереди арбитра с суммой и сторонами', inQueue?.order?.amount === '90000' && inQueue?.buyer === `mdb${rnd}`);
  const view = await j(`/disputes/${dispute.body.id}`, { token: agent.token });
  check('Арбитр видит стороны и может решать', view.body.canResolve === true && view.body.parties?.seller?.id === seller.id);
  await j(`/disputes/${dispute.body.id}/take`, { method: 'POST', token: agent.token });
  await j(`/disputes/${dispute.body.id}/resolve`, { method: 'POST', token: agent.token, body: JSON.stringify({ outcome: 'buyer', note: 'Товар не передан' }) });
  const refunded = await j(`/orders/${order.body.id}`, { token: buyer.token });
  const wb = await j('/wallet', { token: buyer.token });
  check('Решение в пользу покупателя: деньги на балансе', refunded.body.status === 'refunded' && wb.body.balance === '90000', `${refunded.body.status} / ${wb.body.balance}`);
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
  await scenarioSteamTopup(rnd);
  await scenarioQuantity(rnd);
  await scenarioPaymentMethods(rnd);
  await scenarioModeration(rnd);
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
