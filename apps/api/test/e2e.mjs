/**
 * Сквозные e2e-тесты денежных путей против запущенного API + БД.
 * Запуск: API_URL=http://localhost:4090 DATABASE_URL=... node apps/api/test/e2e.mjs
 * Покрывает: эскроу-покупка, авто-выдача ключей и аккаунтов со склада, пополнение на сумму покупателя,
 * продажа поштучно (наличие, перепродажа последней штуки), способы оплаты (надбавка карты,
 * второй платёж по заказу), модерация (жалобы, бан, заморозка, спор у арбитра),
 * аккаунт (чёрный список, профиль, пароль, сеансы), вход с кодом из приложения и защита от подбора,
 * подписка на пуш-уведомления, проверка личности, вход через Google и VK ID,
 * поддержка, ошибки на языке сайта, выплаты (с холдом и ролью finance), оплата через ЮKassa
 * (второй API с PAYMENT_PROVIDER=yookassa против тестового сервера ЮKassa).
 * Выход 0 — все проверки пройдены, иначе 1.
 */
import { spawn } from 'node:child_process';
import { createECDH, createHmac, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { authenticator } from 'otplib';
import db from '../../../packages/db/dist/index.js';
import { startOAuthMock } from './oauth-mock.mjs';
import { startYooKassaMock } from './yookassa-mock.mjs';

const { prisma } = db;
const API = process.env.API_URL ?? 'http://localhost:4090';

const results = [];
function check(name, cond, detail = '') {
  results.push(!!cond);
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function j(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (opts.token) headers.Authorization = 'Bearer ' + opts.token;
  const res = await fetch(`${opts.base ?? API}/api${path}`, { method: opts.method || 'GET', headers, body: opts.body });
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

// Автовыдача аккаунтов, как боты у продавцов FunPay: склад строк, своя
// строка покупателю сразу после оплаты, инструкция продавца в чате.
async function scenarioAutoGoods(rnd) {
  console.log('\n— Автовыдача аккаунтов со склада —');
  const seller = await register('ags', rnd);
  const buyer = await register('agb', rnd);
  const lot = await createListing(seller.token, 'accounts', '99000', {
    autoDelivery: true,
    deliveryTemplate: 'Войдите и смените пароль. Вопросы — в тг @seller',
  });
  const fresh = await prisma.listing.findUnique({ where: { id: lot }, select: { status: true, fulfillmentType: true, deliveryTemplate: true } });
  check('Аккаунт с автовыдачей: склад строк, пока пуст — не в продаже', fresh.fulfillmentType === 'auto_key' && fresh.status === 'sold_out', JSON.stringify(fresh));
  check('Контакты в сообщении после оплаты скрыты сразу', fresh.deliveryTemplate === 'Войдите и смените пароль. Вопросы — в [скрыто] [скрыто]', fresh.deliveryTemplate);
  const add = await j(`/listings/${lot}/keys`, { method: 'POST', token: seller.token, body: JSON.stringify({ keys: ['acc1@mail.test:pass1', 'acc2@mail.test:pass2', 'acc1@mail.test:pass1'] }) });
  check('На складе 2 строки, повтор пропущен', add.body.added === 2 && add.body.skipped === 1, JSON.stringify(add.body));
  const again = await j(`/listings/${lot}/keys`, { method: 'POST', token: seller.token, body: JSON.stringify({ keys: ['acc2@mail.test:pass2'] }) });
  check('Уже лежащее на складе второй раз не ложится', again.body.added === 0 && again.body.skipped === 1, JSON.stringify(again.body));
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  await pay(buyer.token, order.body.id);
  const o = await j(`/orders/${order.body.id}`, { token: buyer.token });
  check('Оплатил — аккаунт выдан сразу', o.body.status === 'delivered' && o.body.listingSnapshot?.goods === 'item', o.body.status);
  const got = await j(`/orders/${order.body.id}/key`, { token: buyer.token });
  check('Покупатель видит свою строку', /^acc[12]@mail\.test:pass[12]$/.test(got.body.key ?? ''), got.body.key);
  const conv = (await j('/conversations', { token: buyer.token })).body.find?.((c) => c.orderId === order.body.id);
  const hist = await j(`/conversations/${conv?.id}/messages`, { token: buyer.token });
  const said = (hist.body ?? []).map((m) => `${m.senderId === seller.id ? 'продавец' : m.senderId ? 'покупатель' : 'площадка'}: ${m.body}`);
  check(
    'В чате: выдача от площадки, затем инструкция от продавца',
    /^площадка: Товар выдан автоматически/.test(said.at(-2) ?? '') && said.at(-1) === 'продавец: Войдите и смените пароль. Вопросы — в [скрыто] [скрыто]',
    JSON.stringify(said.slice(-2)),
  );
  const left = await prisma.listing.findUnique({ where: { id: lot }, select: { stock: true, status: true } });
  check('На складе осталась 1 строка, лот в продаже', left.stock === 1 && left.status === 'active', JSON.stringify(left));
  const off = await j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ autoDelivery: false }) });
  check('Выключили — выдаёт продавец, наличие без ограничения', off.body.fulfillmentType === 'manual' && off.body.stock === null, JSON.stringify({ f: off.body.fulfillmentType, s: off.body.stock }));
  const on = await j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ autoDelivery: true }) });
  check('Включили снова — на складе та же строка', on.body.fulfillmentType === 'auto_key' && on.body.stock === 1 && on.body.status === 'active', JSON.stringify({ f: on.body.fulfillmentType, s: on.body.stock, st: on.body.status }));
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

async function signIn(prefix, rnd, password = 'password123') {
  const r = await j('/auth/login', { method: 'POST', body: JSON.stringify({ email: `${prefix}${rnd}@e2e.local`, password }) });
  return { status: r.status, token: r.body.accessToken };
}

async function scenarioAccount(rnd) {
  console.log('\n— Аккаунт: чёрный список, профиль, пароль, сеансы —');
  const seller = await register('acs', rnd);
  const buyer = await register('acb', rnd);
  const lot = await createListing(seller.token, 'accounts', '50000');
  const paidLot = await createListing(seller.token, 'accounts', '60000');
  // Заказ до блокировки: по нему переписка должна остаться
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: paidLot }) });
  await pay(buyer.token, order.body.id);

  const block = await j('/account/blocks', { method: 'POST', token: seller.token, body: JSON.stringify({ userId: buyer.id }) });
  check('Продавец добавил покупателя в чёрный список', block.status === 201);
  const buy = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  check('Из чёрного списка не купить', buy.status === 403 && /ограничил вам покупки/.test(buy.body.message), buy.body.message);
  const chat = await j(`/conversations/for-listing/${lot}`, { method: 'POST', token: buyer.token });
  check('И не написать до сделки', chat.status === 403);
  const convs = await j('/conversations', { token: buyer.token });
  const orderConv = convs.body.find?.((c) => c.orderId === order.body.id);
  const msg = await j(`/conversations/${orderConv?.id}/messages`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Жду данные аккаунта' }) });
  check('А по оплаченному заказу переписка открыта', msg.status === 201, String(msg.status));
  const sellerConvs = await j('/conversations', { token: seller.token });
  const sc = sellerConvs.body.find?.((c) => c.orderId === order.body.id);
  check(
    'Мессенджер: собеседник, заказ, последнее сообщение, непрочитанное',
    sc?.counterpart?.id === buyer.id && !!sc?.order?.publicNumber && sc?.last?.text === 'Жду данные аккаунта' && sc?.unread === 1,
    JSON.stringify(sc?.last),
  );
  const hist = await j(`/conversations/${orderConv?.id}/messages?limit=1`, { token: seller.token });
  check('История отдаёт последние сообщения, а не первые', hist.body?.[0]?.body === 'Жду данные аккаунта', JSON.stringify(hist.body));
  const sum = await j('/account/summary', { token: seller.token });
  check(
    'Шапка: непрочитанные сообщения и продажи, ждущие выдачи',
    sum.body.unreadMessages >= 1 && sum.body.sales?.toDeliver >= 1 && typeof sum.body.balance?.available === 'string',
    JSON.stringify(sum.body),
  );
  await j(`/account/blocks/${buyer.id}`, { method: 'DELETE', token: seller.token });
  check('Убрал из списка — снова можно купить', (await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) })).status === 201);

  // Чат на странице лота: диалог появляется с первым вопросом, и продавец
  // видит, о каком лоте речь.
  const none = await j(`/conversations/for-listing/${lot}`, { token: buyer.token });
  check('Чат на лоте: до первого вопроса пустого диалога нет', none.status === 200 && none.body.id === null, JSON.stringify(none.body));
  const ask = await j(`/conversations/for-listing/${lot}`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Ещё продаёте?' }) });
  const again = await j(`/conversations/for-listing/${lot}`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'А скидка будет?' }) });
  check(
    'Вопрос с лота: перед ним строка о лоте, второй вопрос — без повтора',
    ask.body.messages?.[0]?.senderId === null && /^Вопрос о лоте «/.test(ask.body.messages[0].body) &&
      ask.body.messages[1]?.body === 'Ещё продаёте?' && again.body.id === ask.body.id && again.body.messages?.length === 1,
    JSON.stringify(ask.body.messages?.map((m) => m.body)),
  );
  const preSale = (await j('/conversations', { token: seller.token })).body.find?.((c) => c.id === ask.body.id);
  check('У продавца два непрочитанных вопроса, строка о лоте не в счёт', preSale?.unread === 2 && preSale?.order === null, String(preSale?.unread));

  const prof = await j('/account/profile', { method: 'PATCH', token: seller.token, body: JSON.stringify({ displayName: 'Склад аккаунтов', bio: 'Отвечаю быстро, пишите в телеграм @fast_seller' }) });
  check('Профиль сохранён, контакты в «о себе» скрыты', prof.body.displayName === 'Склад аккаунтов' && !/fast_seller/.test(prof.body.bio ?? ''), prof.body.bio);
  const pub = await j(`/sellers/${seller.id}`);
  check('Имя видно на витрине', pub.body.displayName === 'Склад аккаунтов');

  // Второе устройство продавца
  const phone = await signIn('acs', rnd);
  const list = await j('/auth/sessions', { token: seller.token });
  check('Видны оба входа, текущий помечен', list.body.length === 2 && list.body.filter((s) => s.current).length === 1, String(list.body.length));
  const wrong = await j('/auth/password', { method: 'POST', token: seller.token, body: JSON.stringify({ current: 'nope', next: 'new-password-1' }) });
  check('Без верного текущего пароль не меняется', wrong.status === 400);
  const changed = await j('/auth/password', { method: 'POST', token: seller.token, body: JSON.stringify({ current: 'password123', next: 'new-password-1' }) });
  check('Смена пароля закрыла второе устройство', changed.body.closedSessions === 1, JSON.stringify(changed.body));
  check('Его токен перестал работать сразу', (await j('/wallet', { token: phone.token })).status === 401);
  check('А этот — работает', (await j('/wallet', { token: seller.token })).status === 200);
  check('Старый пароль не подходит, новый — да', (await signIn("acs", rnd)).status === 401 && (await signIn("acs", rnd, "new-password-1")).status === 200);
  const n0 = await j('/account/notifications', { token: buyer.token });
  check('Уведомления по умолчанию: заказы письмом, сообщения — нет', n0.body.prefs?.email?.orders === true && n0.body.prefs?.email?.messages === false);
  const n1 = await j('/account/notifications', { method: 'PATCH', token: buyer.token, body: JSON.stringify({ email: { orders: false } }) });
  check('Настройка сохраняется', n1.body.prefs?.email?.orders === false);
  check('Чужая группа не попадает в базу', (await j('/account/notifications', { method: 'PATCH', token: buyer.token, body: JSON.stringify({ email: { spam: true } }) })).status === 400);
  check('Без бота ссылка на Telegram не выдаётся', (await j('/account/telegram/link', { method: 'POST', token: buyer.token })).status === 404);
  check('Вебхук бота без секрета закрыт', (await j('/telegram/webhook', { method: 'POST', body: JSON.stringify({ message: { text: '/start x', chat: { id: 1 } } }) })).status === 403);

  const s2 = await j('/auth/sessions', { token: seller.token });
  const other = s2.body.find?.((s) => !s.current);
  await j(`/auth/sessions/${other?.id}/revoke`, { method: 'POST', token: seller.token });
  check('Завершить сеанс другого устройства', (await j('/auth/sessions', { token: seller.token })).body.length === 1);
}

async function scenarioSupport(rnd) {
  console.log('\n— Поддержка —');
  const user = await register('spu', rnd);
  const stranger = await register('spx', rnd);
  const agent = await register('spa', rnd);
  await grant(agent.id, 'agent');
  const seller = await register('sps', rnd);
  const lot = await createListing(seller.token, 'accounts', '30000');
  const order = await j('/orders', { method: 'POST', token: user.token, body: JSON.stringify({ listingId: lot }) });

  const t = await j('/support/tickets', {
    method: 'POST', token: user.token,
    body: JSON.stringify({ category: 'order', orderId: order.body.id, subject: 'Не могу оплатить', body: 'Оплата картой зависает на шаге подтверждения' }),
  });
  check('Обращение создано с заказом', t.status === 201 && t.body.orderId === order.body.id);
  const foreign = await j('/support/tickets', {
    method: 'POST', token: stranger.token,
    body: JSON.stringify({ category: 'order', orderId: order.body.id, subject: 'Чужой заказ', body: 'Пробую прикрепить чужой заказ' }),
  });
  check('Чужой заказ к обращению не прикрепить', foreign.status === 404);
  check('Чужое обращение не открыть', (await j(`/support/tickets/${t.body.id}`, { token: stranger.token })).status === 403);
  const queue = await j('/support/queue', { token: agent.token });
  check('Обращение в очереди поддержки', queue.body.some?.((q) => q.id === t.body.id && q.user === `spu${rnd}`));
  check('Пользователь очередь не видит', (await j('/support/queue', { token: user.token })).status === 403);
  await j(`/support/tickets/${t.body.id}/messages`, { method: 'POST', token: agent.token, body: JSON.stringify({ body: 'Попробуйте оплатить по СБП, проверим карту.' }) });
  const view = await j(`/support/tickets/${t.body.id}`, { token: user.token });
  check('Ответ поддержки виден автору, ход за ним', view.body.ticket.status === 'answered' && view.body.messages.at(-1).fromStaff === true);
  const notif = await j('/notifications', { token: user.token });
  check('Автору пришло уведомление об ответе', notif.body.some?.((n) => n.type === 'support_reply'));
  await j(`/support/tickets/${t.body.id}/close`, { method: 'POST', token: user.token });
  await j(`/support/tickets/${t.body.id}/messages`, { method: 'POST', token: user.token, body: JSON.stringify({ body: 'Снова не проходит' }) });
  check('Сообщение в закрытое обращение открывает его снова', (await j(`/support/tickets/${t.body.id}`, { token: user.token })).body.ticket.status === 'open');
}

async function scenarioCatalog(rnd) {
  console.log('\n— Каталог: А–Я и продавцы онлайн —');
  const idx = await j('/catalog/index');
  const cs2 = idx.body.find?.((g) => g.slug === 'cs2');
  check('Указатель: игры с разделами и числом лотов', cs2?.categories?.some((c) => c.slug === 'accounts' && c.listingCount > 0));
  const titles = idx.body.map((g) => g.title);
  check('Указатель по алфавиту', JSON.stringify(titles) === JSON.stringify([...titles].sort((a, b) => a.localeCompare(b))));

  const on = await register('onl', rnd);
  const off = await register('ofl', rnd);
  const lotOn = await createListing(on.token, 'accounts', '11100');
  const lotOff = await createListing(off.token, 'accounts', '11200');
  await prisma.profile.update({ where: { userId: off.id }, data: { onlineAt: new Date(Date.now() - 3600_000) } });
  await j('/wallet', { token: on.token }); // любой запрос отмечает «онлайн»
  const list = await j('/listings?gameSlug=cs2&categorySlug=accounts&online=1&limit=60');
  const ids = list.body.items.map((l) => l.id);
  check('«Продавец онлайн»: свежий — в выдаче, час назад — нет', ids.includes(lotOn) && !ids.includes(lotOff));
  const all = await j('/listings?gameSlug=cs2&categorySlug=accounts&online=false&limit=60');
  check('online=false фильтр не включает', all.body.items.some((l) => l.id === lotOff));
  const game = await j('/catalog/games/cs2');
  const acc = game.body.categories?.find((c) => c.slug === 'accounts');
  const idxNow = await j('/catalog/index');
  check(
    'Продавцы в сети: у раздела и у игры',
    acc?.sellers?.online >= 1 && acc.sellers.sellers > acc.sellers.online - 1 &&
      game.body.sellers?.sellers >= acc.sellers.sellers && idxNow.body.find?.((g) => g.slug === 'cs2')?.onlineSellers >= 1,
    JSON.stringify({ section: acc?.sellers, game: game.body.sellers }),
  );
}

async function scenarioBuyerData(rnd) {
  console.log('\n— Данные от покупателя —');
  const seller = await register('bds', rnd);
  const buyer = await register('bdb', rnd);
  const fields = [{ label: 'Ник в игре', required: true }, { label: 'Сервер', required: false }];
  const lot = await createListing(seller.token, 'accounts', '25000', { buyerFields: fields });
  const keyGame = await j('/catalog/games/cs2');
  const keysCat = keyGame.body.categories.find((c) => c.slug === 'keys');
  const autoLot = await j('/listings', {
    method: 'POST', token: seller.token,
    body: JSON.stringify({ gameId: keyGame.body.id, categoryId: keysCat.id, title: 'Ключ с полями', description: 'x', price: '1000', attributes: { region: 'Global' }, buyerFields: fields }),
  });
  check('У авто-выдачи полей нет — некому отвечать', autoLot.status === 400);
  const page = await j(`/listings/${lot}`);
  check('Поля видны на странице лота', page.body.buyerFields?.length === 2);
  const missing = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot, buyerData: { Сервер: 'EU' } }) });
  check('Без обязательного поля заказ не создаётся', missing.status === 400 && /Ник в игре/.test(missing.body.message));
  const ok = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot, buyerData: { 'Ник в игре': ' Dragon_77 ', лишнее: 'x' } }) });
  check('Ответы в заказе — только поля лота', JSON.stringify(ok.body.listingSnapshot?.buyerData) === JSON.stringify([{ label: 'Ник в игре', value: 'Dragon_77' }]), JSON.stringify(ok.body.listingSnapshot?.buyerData));
  await j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ buyerFields: null }) });
  check('Продавец убрал поля — покупать без них', (await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) })).status === 201);
}

async function scenarioPromotion(rnd) {
  console.log('\n— Продвижение с баланса —');
  const seller = await register('prs', rnd);
  const g = await j('/catalog/games/cs2');
  const skins = g.body.categories.find((c) => c.slug === 'skins');
  const lot = await createListing(seller.token, 'skins', '77700');
  const poor = await j(`/listings/${lot}/promote`, { method: 'POST', token: seller.token, body: JSON.stringify({ days: 1 }) });
  check('Без денег на балансе продвинуть нельзя', poor.status === 400 && /не хватает/.test(poor.body.message), poor.body.message);

  const top = await j('/payments/topup', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '15000' }) });
  await j('/payments/mock/callback?providerRef=' + top.body.providerRef, { method: 'POST' });
  // Две покупки сразу при деньгах на одну: проходит одна, баланс не уходит в минус.
  const [a, b] = await Promise.all([1, 1].map(() => j(`/listings/${lot}/promote`, { method: 'POST', token: seller.token, body: JSON.stringify({ days: 1 }) })));
  const ok = [a, b].filter((r) => r.status === 201).length;
  const w = await j('/wallet', { token: seller.token });
  check('Двойной клик: списали одни сутки, баланс не в минусе', ok === 1 && w.body.balance === '5100', `${ok} / ${w.body.balance}`);
  const first = await j(`/listings?gameSlug=cs2&categorySlug=${skins.slug}&limit=5`);
  check('Продвигаемый лот первый в разделе', first.body.items[0]?.id === lot && !!first.body.items[0]?.promotedUntil);
  const hist = await j('/wallet/transactions', { token: seller.token });
  check('Списание видно в истории', hist.body.some?.((t) => t.refType === 'promotion' && t.amount === '9900'));
  const bad = await j(`/listings/${lot}/promote`, { method: 'POST', token: seller.token, body: JSON.stringify({ days: 5 }) });
  check('Только пакеты 1, 3, 7 суток', bad.status === 400);

  // Истёкшее продвижение не держит лот наверху: его обнуляет фоновая задача.
  await prisma.listing.update({ where: { id: lot }, data: { promotedUntil: new Date(Date.now() - 1000) } });
  for (let i = 0; i < 20; i++) {
    const l = await prisma.listing.findUnique({ where: { id: lot }, select: { promotedUntil: true } });
    if (!l.promotedUntil) break;
    await wait(500);
  }
  const after = await prisma.listing.findUnique({ where: { id: lot }, select: { promotedUntil: true } });
  check('Истёкшее продвижение обнулено', after.promotedUntil === null);
}

async function scenarioMyLots(rnd) {
  console.log('\n— Мои лоты: цена в строке, галочки, отпуск —');
  const seller = await register('mls', rnd);
  const a = await createListing(seller.token, 'accounts', '50000');
  const b = await createListing(seller.token, 'accounts', '60000');
  const c = await createListing(seller.token, 'accounts', '70000');
  await j(`/listings/${c}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ status: 'paused' }) });
  const price = await j(`/listings/${a}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ price: '55000' }) });
  check('Цена из списка лотов сохраняется', price.status === 200 && price.body.price === '55000', String(price.body.price));

  const off = await j('/listings/bulk', { method: 'POST', token: seller.token, body: JSON.stringify({ ids: [a, b, c], action: 'pause' }) });
  check('Снять выбранные: снимаются только продающиеся', off.body.done === 2 && off.body.skipped === 1, JSON.stringify(off.body));
  const on = await j('/listings/bulk', { method: 'POST', token: seller.token, body: JSON.stringify({ ids: [a, b], action: 'activate' }) });
  check('Вернуть выбранные в продажу', on.body.done === 2, JSON.stringify(on.body));
  const other = await register('mlo', rnd);
  const foreign = await j('/listings/bulk', { method: 'POST', token: other.token, body: JSON.stringify({ ids: [a], action: 'pause' }) });
  check('Чужой лот галочкой не снять', foreign.body.done === 0, JSON.stringify(foreign.body));

  const away = await j('/listings/away', { method: 'POST', token: seller.token, body: JSON.stringify({ away: true }) });
  const pub = await j(`/sellers/${seller.id}`);
  const shown = await j(`/listings?sellerId=${seller.id}`);
  check(
    'Отпуск: лоты ушли с витрины, в профиле пометка',
    away.body.paused === 2 && pub.body.away === true && shown.body.items?.length === 0,
    JSON.stringify(away.body),
  );
  const back = await j('/listings/away', { method: 'POST', token: seller.token, body: JSON.stringify({ away: false }) });
  const mine = await j('/listings/mine', { token: seller.token });
  const status = Object.fromEntries(mine.body.map((l) => [l.id, l.status]));
  check(
    'Из отпуска вернулись только снятые на время отпуска',
    back.body.restored === 2 && status[a] === 'active' && status[b] === 'active' && status[c] === 'paused',
    JSON.stringify(status),
  );
}

async function scenarioTwoFactor(rnd) {
  console.log('\n— Вход с кодом из приложения —');
  const u = await register('tfa', rnd);
  const email = `tfa${rnd}@e2e.local`;
  const login = (code) => j('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: 'password123', ...(code ? { code } : {}) }) });
  const setup = await j('/auth/2fa/setup', { method: 'POST', token: u.token });
  check('Подключение: ключ и QR-код', /^[A-Z2-7]{16,}$/.test(setup.body.secret ?? '') && /<svg/.test(setup.body.qrSvg ?? ''));
  const on = await j('/auth/2fa/enable', { method: 'POST', token: u.token, body: JSON.stringify({ code: authenticator.generate(setup.body.secret) }) });
  check('Включение выдаёт восемь резервных кодов', on.body.recoveryCodes?.length === 8, String(on.body.recoveryCodes?.length));
  const noCode = await login();
  check('Без кода форма просит код, а не пишет «неверный пароль»', noCode.status === 401 && noCode.body.error === 'two_factor_required', JSON.stringify(noCode.body));
  const ok = await login(authenticator.generate(setup.body.secret));
  check('С кодом из приложения — вход', ok.status === 200 && !!ok.body.accessToken, String(ok.status));
  const reserve = on.body.recoveryCodes?.[0];
  const first = await login(reserve);
  const second = await login(reserve);
  check('Резервный код работает один раз', first.status === 200 && second.body.error === 'two_factor_invalid', `${first.status} / ${second.body.error}`);
  await register('tfb', rnd);
  let last;
  for (let i = 0; i < 11; i++) {
    last = await j('/auth/login', { method: 'POST', body: JSON.stringify({ email: `tfb${rnd}@e2e.local`, password: 'wrong-password' }) });
  }
  check('Подбор пароля упирается в паузу', last.status === 429, String(last.status));
}

// Пуши на телефон: подписка устройства, только от служб пушей браузеров,
// своя галочка в группах уведомлений. Ни одного пуша наружу сценарий не шлёт.
async function scenarioPush(rnd) {
  console.log('\n— Пуш-уведомления: подписка устройства —');
  const user = await register('psh', rnd);
  const s0 = await j('/account/notifications', { token: user.token });
  check('Ключ сервера для подписки есть, устройств нет', /^[A-Za-z0-9_-]{80,}$/.test(s0.body.push?.publicKey ?? '') && s0.body.push?.devices === 0, JSON.stringify(s0.body.push));
  check('Пуши по умолчанию включены во всех группах', Object.values(s0.body.prefs?.push ?? {}).every(Boolean) && Object.keys(s0.body.prefs?.push ?? {}).length === 7);
  const ecdh = createECDH('prime256v1');
  const keys = { p256dh: ecdh.generateKeys().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  const endpoint = `https://fcm.googleapis.com/fcm/send/e2e-${rnd}`;
  const sub = await j('/account/push', { method: 'POST', token: user.token, body: JSON.stringify({ endpoint, expirationTime: null, keys }) });
  check('Подписка браузера принята', sub.status === 201 && sub.body.devices === 1, JSON.stringify(sub.body));
  const again = await j('/account/push', { method: 'POST', token: user.token, body: JSON.stringify({ endpoint, keys }) });
  check('Та же подписка второй раз — то же устройство', again.body.devices === 1, JSON.stringify(again.body));
  const evil = await j('/account/push', { method: 'POST', token: user.token, body: JSON.stringify({ endpoint: 'https://evil.example.com/push', keys }) });
  check('Адрес не службы пушей → 400', evil.status === 400, String(evil.status));
  const badKey = await j('/account/push', { method: 'POST', token: user.token, body: JSON.stringify({ endpoint, keys: { p256dh: 'abc', auth: keys.auth } }) });
  check('Испорченный ключ → 400', badKey.status === 400, String(badKey.status));
  const prefs = await j('/account/notifications', { method: 'PATCH', token: user.token, body: JSON.stringify({ push: { messages: false } }) });
  check('Группу пушей можно выключить', prefs.body.prefs?.push?.messages === false && prefs.body.prefs?.push?.orders === true);
  const other = await register('psh2', rnd);
  await j('/account/push', { method: 'POST', token: other.token, body: JSON.stringify({ endpoint, keys }) });
  const moved = await j('/account/notifications', { token: user.token });
  check('Браузер у другого пользователя — устройство переходит к нему', moved.body.push?.devices === 0, JSON.stringify(moved.body.push));
  const off = await j('/account/push', { method: 'DELETE', token: other.token, body: JSON.stringify({ endpoint }) });
  check('Выключить на устройстве', off.status === 200 && off.body.devices === 0, JSON.stringify(off.body));
}

async function scenarioFiles(rnd) {
  console.log('\n— Файлы без S3: вложения в чате и фото лотов —');
  const abs = (u) => new URL(u, API).toString();
  const seller = await register('fls', rnd);
  const buyer = await register('flb', rnd);
  const lot = await createListing(seller.token, 'accounts', '30000');
  const conv = await j(`/conversations/for-listing/${lot}`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Пришлю скриншот' }) });
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const up = await j(`/conversations/${conv.body.id}/uploads`, { method: 'POST', token: buyer.token, body: JSON.stringify({ mime: 'image/png' }) });
  const put = await fetch(abs(up.body.uploadUrl), { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } });
  const att = await j(`/conversations/${conv.body.id}/attachments`, { method: 'POST', token: buyer.token, body: JSON.stringify({ key: up.body.key, mime: 'image/png', size: png.length }) });
  const url = att.body.attachments?.[0]?.url;
  const got = url ? await fetch(abs(url)) : null;
  const bytes = got ? Buffer.from(await got.arrayBuffer()) : Buffer.alloc(0);
  check('Вложение в чате: загрузка и чтение по подписанной ссылке', put.status === 200 && got?.status === 200 && bytes.equals(png), `${put.status} / ${got?.status}`);
  const forged = url ? await fetch(abs(url).replace(/sig=[^&]+/, 'sig=forged')) : null;
  check('Изменённая ссылка файл не открывает', forged?.status === 403, String(forged?.status));

  const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}' + '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
  const up2 = await j(`/conversations/${conv.body.id}/uploads`, { method: 'POST', token: buyer.token, body: JSON.stringify({ mime: 'text/plain' }) });
  await fetch(abs(up2.body.uploadUrl), { method: 'PUT', body: eicar, headers: { 'Content-Type': 'text/plain' } });
  const bad = await j(`/conversations/${conv.body.id}/attachments`, { method: 'POST', token: buyer.token, body: JSON.stringify({ key: up2.body.key, mime: 'text/plain', size: eicar.length }) });
  check('Заражённый файл не проходит проверку', bad.status === 400 && /антивирус/.test(bad.body.message ?? ''), bad.body.message);

  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'shot.png');
  const img = await fetch(`${API}/api/listings/uploads`, { method: 'POST', headers: { Authorization: 'Bearer ' + seller.token }, body: form }).then((r) => r.json());
  const pub = img.key ? await fetch(`${API}/api/assets?key=${encodeURIComponent(img.key)}`) : null;
  check('Фото лота загружается и видно на витрине', pub?.status === 200 && pub.headers.get('content-type') === 'image/png', JSON.stringify(img));
}

// Проверка личности: документ и селфи, сотрудник видит их и решает, отказ —
// с причиной, после одобрения — «Документы проверены» в профиле.
async function scenarioKyc(rnd) {
  console.log('\n— Проверка личности —');
  const abs = (u) => new URL(u, API).toString();
  const seller = await register('kys', `k${rnd}`);
  const stranger = await register('kyx', `k${rnd}`);
  const mod = await register('kym', `k${rnd}`);
  await grant(mod.id, 'moderator');
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const upload = async (who) => {
    const up = await j('/kyc/uploads', { method: 'POST', token: who.token, body: JSON.stringify({ mime: 'image/png' }) });
    const put = await fetch(abs(up.body.uploadUrl), { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } });
    return put.ok ? up.body.key : null;
  };
  check('Сначала проверки нет', (await j('/kyc/me', { token: seller.token })).body.status === 'none');
  const html = await j('/kyc/uploads', { method: 'POST', token: seller.token, body: JSON.stringify({ mime: 'text/html' }) });
  check('HTML вместо фото документа не принимается', html.status === 400, String(html.status));
  const [doc, selfie, foreign] = [await upload(seller), await upload(seller), await upload(stranger)];
  const steal = await j('/kyc', { method: 'POST', token: seller.token, body: JSON.stringify({ documentKeys: [foreign], selfieKey: selfie }) });
  check('Чужой файл в заявку не берётся', steal.status === 400, String(steal.status));
  const sent = await j('/kyc', { method: 'POST', token: seller.token, body: JSON.stringify({ documentKeys: [doc], selfieKey: selfie }) });
  check('Документ и селфи — на проверке', sent.status === 201 && sent.body.status === 'pending', JSON.stringify(sent.body));
  const twice = await j('/kyc', { method: 'POST', token: seller.token, body: JSON.stringify({ documentKeys: [doc], selfieKey: selfie }) });
  check('Пока на проверке, вторая заявка не принимается', twice.status === 409, String(twice.status));
  const queue = await j('/kyc/pending', { token: mod.token });
  const mine = queue.body.find?.((k) => k.userId === seller.id);
  const shown = mine?.files?.[0] ? await fetch(abs(mine.files[0].url)) : null;
  check('Сотрудник видит заявку: кто, документ и селфи', mine?.user?.username === `kys${'k' + rnd}` && mine.files.length === 2 && shown?.status === 200, JSON.stringify(mine?.files?.map((f) => f.kind)));
  check('Продавцу очередь недоступна', (await j('/kyc/pending', { token: seller.token })).status === 403);
  const noReason = await j(`/kyc/${mine?.id}/review`, { method: 'POST', token: mod.token, body: JSON.stringify({ decision: 'reject' }) });
  check('Отказ без причины не проходит', noReason.status === 400, String(noReason.status));
  await j(`/kyc/${mine?.id}/review`, { method: 'POST', token: mod.token, body: JSON.stringify({ decision: 'reject', reason: 'Селфи размыто' }) });
  const after = await j('/kyc/me', { token: seller.token });
  const bell = await j('/notifications', { token: seller.token });
  check('Продавец видит причину отказа и уведомление', after.body.status === 'rejected' && after.body.reason === 'Селфи размыто' && bell.body.some?.((n) => n.type === 'kyc_rejected'), JSON.stringify(after.body));
  const again = await j('/kyc', { method: 'POST', token: seller.token, body: JSON.stringify({ documentKeys: [await upload(seller)], selfieKey: await upload(seller) }) });
  const next = (await j('/kyc/pending', { token: mod.token })).body.find?.((k) => k.userId === seller.id);
  await j(`/kyc/${next?.id}/review`, { method: 'POST', token: mod.token, body: JSON.stringify({ decision: 'approve' }) });
  const profile = await j(`/sellers/${seller.id}`);
  check('Переснял — одобрено, в профиле «Документы проверены»', again.status === 201 && profile.body.verified === true, JSON.stringify({ s: again.status, v: profile.body.verified }));
}

// Вход через Google и VK ID — весь обмен кодом против тестового сервера
// (oauth-mock.mjs): state, PKCE, выбор ника, привязка в «Безопасности»,
// код из приложения и для входа через сервис.
async function scenarioSocial(rnd, mock) {
  console.log('\n— Вход через Google и VK ID —');
  const cookieOf = (res, name) =>
    res.headers.getSetCookie().map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`))?.slice(name.length + 1);
  const go = (url, cookie) => fetch(url, { redirect: 'manual', headers: cookie ? { cookie } : {} });
  // Браузер: начало → сервис → возврат на API → билет в cookie
  async function signIn(provider, next = '/', linkCookie) {
    const start = await go(`${API}/api/auth/oauth/${provider}/start?next=${encodeURIComponent(next)}`, linkCookie && `gm_link=${linkCookie}`);
    const state = cookieOf(start, 'gm_oauth');
    const back = await go(start.headers.get('location'));
    const cb = await go(back.headers.get('location'), state && `gm_oauth=${state}`);
    return { location: cb.headers.get('location') ?? '', ticket: cookieOf(cb, 'gm_social'), back: back.headers.get('location'), state };
  }
  const complete = async (ticket, body = {}) => {
    const r = await fetch(`${API}/api/auth/social/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: `gm_social=${ticket}` },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };

  const on = await j('/auth/social');
  check('Кнопки — у подключённых сервисов: Google и VK есть, Telegram без бота нет', on.body.google && on.body.vk && on.body.telegram === null, JSON.stringify(on.body));

  mock.as('google', { sub: `g-${rnd}`, email: `anna${rnd}@gmail.test`, email_verified: true, name: 'Анна Смирнова' });
  const first = await signIn('google', '/lot/abc');
  check('Google вернул в браузер билет и страницу завершения с адресом возврата', !!first.ticket && first.location.endsWith('/login/social?next=%2Flot%2Fabc'), first.location);
  const nick = await complete(first.ticket);
  check('Новый человек — сначала ник, подсказка из имени', nick.status === 400 && nick.body.error === 'username_required' && nick.body.suggested === 'anna_smirnova', JSON.stringify(nick.body));
  const made = await complete(first.ticket, { username: `anna_${rnd}` });
  check('С ником — вход, почта от Google подтверждена', made.status === 200 && !!made.body.accessToken && made.body.user.email === `anna${rnd}@gmail.test`, String(made.status));
  const again = await complete((await signIn('google')).ticket);
  check('Второй вход через Google — тот же аккаунт без вопросов', again.status === 200 && again.body.user.id === made.body.user.id, String(again.status));
  const ways = await j('/auth/social/accounts', { token: made.body.accessToken });
  check('В «Безопасности»: Google подключён, пароля нет', ways.body.hasPassword === false && ways.body.accounts?.[0]?.provider === 'google', JSON.stringify(ways.body));
  const lastWay = await j('/auth/social/google', { method: 'DELETE', token: made.body.accessToken });
  check('Единственный способ входа без пароля не отключается', lastWay.status === 400, String(lastWay.status));
  const pwd = await j('/auth/password', { method: 'POST', token: made.body.accessToken, body: JSON.stringify({ next: 'password-from-google' }) });
  const off = await j('/auth/social/google', { method: 'DELETE', token: made.body.accessToken });
  check('Задал пароль — Google отключается', pwd.status === 200 && off.status === 200 && off.body.accounts.length === 0, `${pwd.status} / ${off.status}`);

  const forged = await signIn('google');
  const tampered = await go(forged.back.replace(/state=[^&]+/, 'state=forged'), `gm_oauth=${forged.state}`);
  check('Чужой state — ни входа, ни билета', /social_error=state$/.test(tampered.headers.get('location') ?? '') && !cookieOf(tampered, 'gm_social'), tampered.headers.get('location'));

  // VK: почта совпала с аккаунтом без подтверждённой почты — только вручную
  const owner = await register('vko', rnd);
  mock.as('vk', { user_id: 5000000 + (rnd % 1000000), first_name: 'Олег', last_name: 'Ким', email: `vko${rnd}@e2e.local` });
  const clash = await complete((await signIn('vk')).ticket);
  check('Почта VK совпала с чужим аккаунтом — он не отдаётся', clash.status === 409 && clash.body.error === 'social_email_taken', JSON.stringify(clash.body));
  const intent = await fetch(`${API}/api/auth/social/link-intent`, { method: 'POST', headers: { Authorization: `Bearer ${owner.token}` } });
  const linked = await signIn('vk', '/', cookieOf(intent, 'gm_link'));
  check('Вошёл по паролю и подключил VK в «Безопасности»', /\/cabinet\/security\?social=linked&provider=vk$/.test(linked.location), linked.location);
  const viaVk = await complete((await signIn('vk')).ticket);
  check('Теперь вход через VK — в этот аккаунт', viaVk.status === 200 && viaVk.body.user.id === owner.id, String(viaVk.status));

  const setup = await j('/auth/2fa/setup', { method: 'POST', token: owner.token });
  await j('/auth/2fa/enable', { method: 'POST', token: owner.token, body: JSON.stringify({ code: authenticator.generate(setup.body.secret) }) });
  const ticket = (await signIn('vk')).ticket;
  const ask = await complete(ticket);
  const withCode = await complete(ticket, { code: authenticator.generate(setup.body.secret) });
  check('С защитой входа и через VK спрашивается код из приложения', ask.status === 401 && ask.body.error === 'two_factor_required' && withCode.status === 200, `${ask.body.error} / ${withCode.status}`);

  // Ссылка из письма подписана тем же ключом, что вход, — но входом не является
  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret) {
    const hs256 = (payload) => {
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const t = Math.floor(Date.now() / 1000);
      const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ ...payload, iat: t, exp: t + 600 })}`;
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    };
    const letter = await j('/auth/me', { token: hs256({ sub: owner.id, purpose: 'email_verify' }) });
    const control = await j('/auth/me', { token: hs256({ sub: owner.id, username: `vko${rnd}` }) });
    check('Ссылка подтверждения почты — не вход в API', letter.status === 401 && control.status === 200, `${letter.status} / ${control.status}`);
  }
}

async function scenarioLanguage(rnd) {
  console.log('\n— Ошибки на языке сайта —');
  const login = (headers) =>
    j('/auth/login', { method: 'POST', headers, body: JSON.stringify({ email: `nobody${rnd}@e2e.local`, password: 'password123' }) });
  const en = await login({ 'Accept-Language': 'en' });
  check('Английский сайт — ошибка входа по-английски и lang: en', en.status === 401 && en.body.message === 'Incorrect email or password' && en.body.lang === 'en', JSON.stringify(en.body));
  const ru = await login({});
  check('Без языка — по-русски, как раньше', ru.status === 401 && ru.body.message === 'Неверные данные' && !('lang' in ru.body), JSON.stringify(ru.body));
  const user = await register('lng', rnd);
  const ticket = (headers) =>
    j('/support/tickets', { method: 'POST', token: user.token, headers, body: JSON.stringify({ subject: 'Hi', category: 'other', body: 'short' }) });
  const fields = await ticket({ 'Accept-Language': 'en-US,en;q=0.9' });
  check('Поля проверки переведены, lang: en', fields.status === 400 && fields.body.subject?.[0] === 'Subject must be at least 3 characters' && fields.body.lang === 'en', JSON.stringify(fields.body));
  const ruFields = await ticket({ 'Accept-Language': 'ru' });
  check('Русский сайт — поля проверки по-русски', ruFields.body.subject?.[0] === 'Тема — от 3 символов' && !('lang' in ruFields.body));

  // Язык писем, Telegram и пушей: запоминается при входе и в переключателе.
  const settings = async () => (await j('/account/notifications', { token: user.token })).body.locale;
  check('Новый аккаунт без языка — письма по-русски', (await settings()) === 'ru');
  const enLogin = await j('/auth/login', {
    method: 'POST',
    headers: { 'Accept-Language': 'en' },
    body: JSON.stringify({ email: `lng${rnd}@e2e.local`, password: 'password123' }),
  });
  check('Вход с английского сайта — письма по-английски', enLogin.status === 200 && (await settings()) === 'en');
  const bad = await j('/account/locale', { method: 'PUT', token: user.token, body: JSON.stringify({ locale: 'de' }) });
  const back = await j('/account/locale', { method: 'PUT', token: user.token, body: JSON.stringify({ locale: 'ru' }) });
  check('Переключатель меняет язык, неизвестный не принимается', bad.status === 400 && back.status === 200 && (await settings()) === 'ru', `${bad.status}/${back.status}`);
  const refreshed = await j('/auth/register', {
    method: 'POST',
    headers: { 'Accept-Language': 'en-GB,en;q=0.9' },
    body: JSON.stringify({ email: `lng2${rnd}@e2e.local`, password: 'password123', username: `lng2${rnd}` }),
  });
  const enUser = (await j('/account/notifications', { token: refreshed.body.accessToken })).body.locale;
  check('Регистрация с английского сайта — профиль на английском', refreshed.status === 201 && enUser === 'en', `${refreshed.status} ${enUser}`);
}

async function scenarioRates(rnd) {
  console.log('\n— Курсы для показа цен —');
  const admin = await register('rta', rnd);
  const user = await register('rtu', rnd);
  await grant(admin.id, 'admin');
  check('Курс задаёт только администратор', (await j('/admin/rates', { method: 'PUT', token: user.token, body: JSON.stringify({ USD: 92, EUR: 100 }) })).status === 403);
  check('Опечатка на порядок не проходит', (await j('/admin/rates', { method: 'PUT', token: admin.token, body: JSON.stringify({ USD: 9.2, EUR: 100 }) })).status === 400);
  await j('/admin/rates', { method: 'PUT', token: admin.token, body: JSON.stringify({ USD: 92.5, EUR: 100.1 }) });
  const pub = await j('/fees/public');
  check('Курсы видны витрине', pub.body.rates?.USD === 92.5 && pub.body.rates?.EUR === 100.1, JSON.stringify(pub.body.rates));
}

async function scenarioPayout(rnd) {
  console.log('\n— Выплаты (finance) —');
  // «Помощь» называет сроки и пороги из этих полей, а не из текста статьи.
  const terms = await j('/fees/public');
  check(
    'Условия для «Помощи»: проверка авто-товаров, порог верификации, ожидание первого вывода',
    Number.isInteger(terms.body.autoGoodsConfirmHours) && /^\d+$/.test(terms.body.payoutKycAboveMinor ?? '') &&
      Number.isInteger(terms.body.payoutNewbieHoldDays),
    JSON.stringify({ a: terms.body.autoGoodsConfirmHours, k: terms.body.payoutKycAboveMinor, h: terms.body.payoutNewbieHoldDays }),
  );
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
  check('Заявка создана (requested), продавцу — маска карты', req.body.status === 'requested' && req.body.destinationHint === '•••• 1111', req.body.destinationHint);
  const wHold = await j('/wallet', { token: seller.token });
  check('Резерв: баланс 35000', wHold.body.balance === '35000', wHold.body.balance);
  const noAccess = await j(`/payouts/${req.body.id}/approve`, { method: 'POST', token: seller.token });
  check('Продавец не одобряет свою выплату → 403', noAccess.status === 403);
  // Ручная выплата: сотруднику нужны реквизиты — раньше их негде было увидеть.
  const peek = await j(`/payouts/${req.body.id}/destination`, { token: seller.token });
  const reveal = await j(`/payouts/${req.body.id}/destination`, { token: fin.token });
  const logged = await prisma.auditLog.count({ where: { entityId: req.body.id, action: 'payout.reveal' } });
  check(
    'Реквизиты ручной выплаты — сотруднику финансов, с записью в журнал; продавцу чужие — 403',
    peek.status === 403 && reveal.body.destination === '4111111111111111' && logged === 1,
    JSON.stringify({ peek: peek.status, reveal: reveal.status, logged }),
  );
  const appr = await j(`/payouts/${req.body.id}/approve`, { method: 'POST', token: fin.token });
  check('Finance одобрил → paid', appr.body.status === 'paid');
}

/**
 * Защита перед запуском: заголовки, CORS только для сайта, лимит запросов
 * с адреса. Адрес покупателя приходит в X-Forwarded-For — API верит ему
 * от локального прокси, как за ingress.
 */
async function scenarioSecurity(rnd) {
  console.log('\n— Защита: заголовки, CORS, лимиты —');
  const raw = (path, headers = {}, init = {}) => fetch(`${API}/api${path}`, { ...init, headers });
  const ready = await raw('/health/ready');
  check('Готовность: база доступна — 200', ready.status === 200);
  const h = await raw('/health');
  check(
    'Заголовки безопасности, без X-Powered-By',
    h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('x-frame-options') === 'DENY' && !h.headers.get('x-powered-by'),
  );
  const evil = await raw('/health', { Origin: 'https://evil.example' });
  const site = await raw('/health', { Origin: 'http://localhost:3000' });
  check(
    'CORS: чужой сайт не получает доступа, сайт площадки — получает',
    !evil.headers.get('access-control-allow-origin') && site.headers.get('access-control-allow-origin') === 'http://localhost:3000',
  );
  const ip = `10.${(rnd >> 8) % 250}.${rnd % 250}.7`;
  const forgot = (from, lang) =>
    j('/auth/forgot', {
      method: 'POST',
      headers: { 'X-Forwarded-For': from, ...(lang ? { 'Accept-Language': lang } : {}) },
      body: JSON.stringify({ email: `nobody${rnd}@e2e.local` }),
    });
  const first = [];
  for (let i = 0; i < 5; i++) first.push((await forgot(ip)).status);
  const sixth = await raw('/auth/forgot', { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'Accept-Language': 'en' }, {
    method: 'POST',
    body: JSON.stringify({ email: `nobody${rnd}@e2e.local` }),
  });
  const body = await sixth.json();
  check(
    'Письма сброса с одного адреса — пять за 15 минут, дальше 429 с Retry-After',
    first.every((st) => st === 200) && sixth.status === 429 && Number(sixth.headers.get('retry-after')) > 0 && body.error === 'rate_limited',
    `${first.join(',')} → ${sixth.status}`,
  );
  check('Отказ по лимиту — на языке сайта', /^Too many requests/.test(body.message) && body.lang === 'en', body.message);
  check('Другой адрес — свой счётчик', (await forgot(`${ip.slice(0, -2)}.8`)).status === 200);
}

/**
 * Оплата через ЮKassa. Платёжный провайдер выбирается при запуске API, а
 * остальные сценарии платят заглушкой, — поэтому здесь поднимается второй
 * API (порт 4100) с PAYMENT_PROVIDER=yookassa против тестового сервера
 * ЮKassa (yookassa-mock.mjs). Фоновые таймеры заказов у него выключены:
 * их ведёт основной API.
 */
async function scenarioYooKassa(rnd) {
  console.log('\n— Оплата через ЮKassa —');
  const base = 'http://localhost:4100';
  const yk = await startYooKassaMock('http://localhost:4998/v3', { shopId: 'e2e-shop', secretKey: 'e2e-secret' });
  yk.notifyTo(`${base}/api/payments/webhook/yookassa`);
  yk.notifyPayoutsTo(`${base}/api/payouts/webhook/yookassa`);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url))], {
    env: {
      ...process.env,
      API_PORT: '4100',
      API_URL: base,
      PAYMENT_PROVIDER: 'yookassa',
      YOOKASSA_SHOP_ID: 'e2e-shop',
      YOOKASSA_SECRET_KEY: 'e2e-secret',
      YOOKASSA_API_URL: 'http://localhost:4998/v3',
      PAYOUT_PROVIDER: 'yookassa',
      YOOKASSA_PAYOUT_AGENT_ID: 'e2e-agent',
      YOOKASSA_PAYOUT_SECRET_KEY: 'e2e-agent-secret',
      YOOKASSA_PAYOUT_WIDGET_URL: 'http://localhost:4998/payouts-data/widget.js',
      PAYOUT_SWEEP_INTERVAL_MS: '3600000',
      WEB_URL: 'http://localhost:3000',
      ORDER_SWEEP_INTERVAL_MS: '3600000',
      SKIP_DOTENV: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const k = (path, opts = {}) => j(path, { ...opts, base });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = (await k('/health').catch(() => ({ status: 0 }))).status === 200;
      if (!up) await wait(500);
    }
    check('Второй API с ЮKassa запущен', up, up ? '' : stderr.slice(-400));
    if (!up) return;

    const pub = await k('/fees/public');
    check(
      'Витрина: оплата настоящая, криптовалюты у ЮKassa нет',
      pub.body.paymentsDemo === false && pub.body.payMethods.includes('sbp') && !pub.body.payMethods.includes('crypto'),
      JSON.stringify(pub.body.payMethods),
    );
    const reg = async (p) => {
      const r = await k('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: `${p}${rnd}@e2e.local`, password: 'password123', username: `${p}${rnd}` }),
      });
      return { token: r.body.accessToken, id: r.body.user?.id };
    };
    const seller = await reg('yks');
    const buyer = await reg('ykb');
    const game = await k('/catalog/games/cs2');
    const cat = game.body.categories.find((c) => c.slug === 'accounts');
    const order = async () => {
      const lot = await k('/listings', {
        method: 'POST',
        token: seller.token,
        body: JSON.stringify({
          gameId: game.body.id, categoryId: cat.id, title: 'E2E yookassa', description: 'test', price: '150000', currency: 'RUB',
          attributes: REQUIRED_ATTRS.accounts ?? {},
        }),
      });
      return (await k('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot.body.id }) })).body;
    };
    const status = async (id) => (await k(`/orders/${id}`, { token: buyer.token })).body.status;
    const deposit = (orderId, method) =>
      k('/payments/deposit', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId, method }) });
    const atYk = (providerRef) => [...yk.payments.values()].find((p) => p.metadata.providerRef === providerRef);

    const o1 = await order();
    const crypto = await deposit(o1.id, 'crypto');
    check('Криптовалюта через ЮKassa не принимается', crypto.status === 400, crypto.body.message);
    const dep = await deposit(o1.id, 'card');
    const p1 = atYk(dep.body.providerRef);
    check(
      'Платёж у ЮKassa: её страница оплаты, сумма с надбавкой карты, возврат на заказ',
      dep.body.redirect === true && dep.body.url === p1?.confirmation.confirmation_url && p1.amount.value === '1566.00' &&
        p1.payment_method_data?.type === 'bank_card' && p1.confirmation.return_url.endsWith(`/orders/${o1.id}?paid=1`),
      JSON.stringify({ amount: p1?.amount, method: p1?.payment_method_data }),
    );
    const devHole = await k(`/payments/mock/callback?providerRef=${dep.body.providerRef}`, { method: 'POST' });
    check('Кнопка «оплачено» заглушки закрыта', devHole.status === 404 && (await status(o1.id)) === 'created');
    const forged = await k('/payments/webhook/yookassa', {
      method: 'POST',
      body: JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { ...p1, status: 'succeeded', paid: true } }),
    });
    check(
      'Поддельное «оплачено», пока ЮKassa ждёт оплату, — без последствий',
      forged.status === 200 && forged.body.ignored === true && (await status(o1.id)) === 'created',
      JSON.stringify(forged.body),
    );
    const unknown = await k('/payments/webhook/yookassa', {
      method: 'POST',
      body: JSON.stringify({ type: 'notification', event: 'payment.succeeded', object: { id: 'yk-nope' } }),
    });
    check('Уведомление о чужом платеже отклоняется', unknown.status === 401);
    const paid = await yk.settle(p1.id, 'succeeded');
    check('ЮKassa подтвердила — заказ оплачен', paid?.status === 200 && (await status(o1.id)) === 'paid', JSON.stringify(paid?.body));
    const again = await yk.settle(p1.id, 'succeeded');
    check('Повторное уведомление — без второго проведения', again?.body?.alreadyProcessed === true);
    const row = await prisma.payment.findUnique({ where: { providerRef: dep.body.providerRef } });
    check('Номер платежа ЮKassa сохранён', row?.externalId === p1.id && row?.provider === 'yookassa');

    const o2 = await order();
    const dep2 = await deposit(o2.id, 'sbp');
    const p2 = atYk(dep2.body.providerRef);
    const tampered = await yk.settle(p2.id, 'succeeded', { amount: '1.00' });
    check(
      'Оплата другой суммы заказ не закрывает; СБП — своим способом',
      tampered?.status === 400 && (await status(o2.id)) === 'created' && p2.payment_method_data?.type === 'sbp',
    );

    const o3 = await order();
    const dep3 = await deposit(o3.id, 'card');
    await yk.settle(atYk(dep3.body.providerRef).id, 'canceled');
    const failed = await prisma.payment.findUnique({ where: { providerRef: dep3.body.providerRef } });
    check('Отменённая оплата — платёж неудачный, заказ ждёт оплаты', failed?.status === 'failed' && (await status(o3.id)) === 'created');

    const top = await k('/payments/topup', { method: 'POST', token: buyer.token, body: JSON.stringify({ amount: '50000', method: 'sbp' }) });
    const pt = atYk(top.body.providerRef);
    await yk.settle(pt.id, 'succeeded');
    const wallet = await k('/wallet', { token: buyer.token });
    check(
      'Пополнение баланса через ЮKassa — деньги после подтверждения',
      top.body.redirect === true && pt.confirmation.return_url.endsWith('/cabinet?topup=1') && wallet.body.balance === '50000',
      wallet.body.balance,
    );

    // ── Выплаты продавцу через ЮKassa ──
    await k(`/orders/${o1.id}/deliver`, { method: 'POST', token: seller.token });
    await k(`/orders/${o1.id}/confirm`, { method: 'POST', token: buyer.token });
    const fin = await reg('ykf');
    await grant(fin.id, 'finance');
    const balance = async () => (await k('/wallet', { token: seller.token })).body.balance;
    const methods = (await k('/payouts/methods', { token: seller.token })).body;
    const banks = (await k('/payouts/sbp-banks', { token: seller.token })).body;
    const cardMethod = methods.find((m) => m.key === 'card');
    check(
      'Вывод: СБП, ЮMoney и карта — автоматически, USDT — вручную; банки СБП от ЮKassa; карта — через виджет',
      methods.find((m) => m.key === 'sbp')?.auto === true && cardMethod?.auto === true &&
        methods.find((m) => m.key === 'usdt')?.auto === false && banks.some((b) => b.id === '100000000111') &&
        cardMethod.widget?.accountId === 'e2e-agent' && cardMethod.widget.scriptUrl.endsWith('/payouts-data/widget.js'),
      JSON.stringify(cardMethod),
    );
    const ask = (body) => k('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify(body) });
    const noBank = await ask({ amount: '50000', method: 'sbp', destination: '+7 900 123-45-67' });
    check('СБП без банка не принимается', noBank.status === 400, noBank.body.message);
    const sbp = await ask({ amount: '50000', method: 'sbp', destination: '+7 900 123-45-67', bankId: '100000000111' });
    const approve = (id) => k(`/payouts/${id}/approve`, { method: 'POST', token: fin.token, body: '{}' });
    const sent = await approve(sbp.body.id);
    const po = [...yk.payouts.values()].find((p) => p.metadata?.payoutId === sbp.body.id);
    check(
      'Одобрено — выплата ушла в ЮKassa: на руки без комиссии, телефон и банк; статус «отправляется»',
      sent.body.status === 'processing' && po?.amount.value === '475.00' && po.payout_destination.phone === '79001234567' &&
        po.payout_destination.bank_id === '100000000111',
      JSON.stringify({ status: sent.body.status, amount: po?.amount }),
    );
    const twice = await approve(sbp.body.id);
    check('Повторное одобрение — отказ, вторая выплата не уходит', twice.status === 409 && yk.payouts.size === 1);
    await yk.settlePayout(po.id, 'succeeded');
    const mine = async (id) => (await k('/payouts/mine', { token: seller.token })).body.find((p) => p.id === id);
    check('ЮKassa подтвердила — «выплачено»', (await mine(sbp.body.id))?.status === 'paid');

    const ym = await ask({ amount: '40000', method: 'yoomoney', destination: '4100 1234 5678 901' });
    await approve(ym.body.id);
    const before = await balance();
    const pym = [...yk.payouts.values()].find((p) => p.metadata?.payoutId === ym.body.id);
    await yk.settlePayout(pym.id, 'canceled', { reason: 'rejected_by_payee' });
    const back = await mine(ym.body.id);
    check(
      'ЮKassa отменила — деньги вернулись на баланс, причина в заявке',
      back?.status === 'rejected' && back.failureReason === 'rejected_by_payee' && BigInt(await balance()) === BigInt(before) + 40000n,
      `${before} → ${await balance()}`,
    );
    // Карта: номер вводится в виджет ЮKassa, площадке — токен и маска.
    const byNumber = await ask({ amount: '30000', method: 'card', destination: '5555555555554477' });
    check('Карта номером, мимо виджета ЮKassa — 400', byNumber.status === 400, byNumber.body.message);
    const t = yk.tokenizeCard('5555555555554477');
    const card = await ask({
      amount: '30000',
      method: 'card',
      card: { token: t.payout_token, first6: t.first6, last4: t.last4, type: t.card_type, issuer: t.issuer_name },
    });
    const stored = await prisma.payout.findUnique({ where: { id: card.body.id } });
    const hidden = await k(`/payouts/${card.body.id}/destination`, { token: fin.token });
    check(
      'Заявка на карту: маска •••• 4477, номера в базе нет, раскрывать нечего',
      card.body.destinationHint === '•••• 4477' && !stored.destinationEnc.includes('5555') && hidden.status === 400,
      JSON.stringify({ hint: card.body.destinationHint, hidden: hidden.status }),
    );
    await approve(card.body.id);
    const pc = [...yk.payouts.values()].find((p) => p.metadata?.payoutId === card.body.id);
    check(
      'Карта ушла в ЮKassa токеном: на руки 275 ₽ (комиссия 25 ₽), получатель — карта •••• 4477',
      pc?.amount.value === '275.00' && pc.payout_destination.type === 'bank_card' && pc.payout_destination.card.last4 === '4477',
      JSON.stringify(pc?.payout_destination),
    );
    await yk.settlePayout(pc.id, 'succeeded');
    check('Выплата на карту подтверждена — «выплачено»', (await mine(card.body.id))?.status === 'paid');

    const usdt = await ask({ amount: '50000', method: 'usdt', destination: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' });
    const manual = await approve(usdt.body.id);
    check('USDT — вручную: одобрение сразу «выплачено», в ЮKassa не уходит', manual.body.status === 'paid' && yk.payouts.size === 3);
  } finally {
    child.kill();
    yk.close();
  }
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
  await scenarioAutoGoods(rnd);
  await scenarioSteamTopup(rnd);
  await scenarioQuantity(rnd);
  await scenarioPaymentMethods(rnd);
  await scenarioModeration(rnd);
  await scenarioAccount(rnd);
  await scenarioSupport(rnd);
  await scenarioCatalog(rnd);
  await scenarioBuyerData(rnd);
  await scenarioPromotion(rnd);
  await scenarioMyLots(rnd);
  await scenarioTwoFactor(rnd);
  await scenarioPush(rnd);
  await scenarioFiles(rnd);
  await scenarioKyc(rnd);
  // Вход через сервисы — только если API запущен с тестовым сервером входа
  if (process.env.OAUTH_TEST_ISSUER) {
    const mock = await startOAuthMock(process.env.OAUTH_TEST_ISSUER);
    await scenarioSocial(rnd, mock);
    mock.close();
  } else {
    console.log('\n— Вход через Google и VK ID — пропущен: нет OAUTH_TEST_ISSUER —');
  }
  await scenarioLanguage(rnd);
  await scenarioRates(rnd);
  await scenarioPayout(rnd);
  await scenarioSecurity(rnd);
  await scenarioYooKassa(rnd);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== E2E: ${passed}/${results.length} проверок пройдено ===`);
  await prisma.$disconnect().catch(() => {});
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error('E2E FAIL', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
