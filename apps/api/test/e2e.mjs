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
import { startTelegramMock } from './telegram-mock.mjs';

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
  // Только лоты этого продавца: в общей выдаче его лот может уйти за первые 60
  // за поднятыми, а проверяем лишь, что online=false не включает фильтр.
  const all = await j(`/listings?gameSlug=cs2&categorySlug=accounts&online=false&sellerId=${off.id}&limit=60`);
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
  // Девять групп: с частью 34 добавились «Сохранённые поиски», с частью 56 — «Безопасность».
  check('Пуши по умолчанию включены во всех группах', Object.values(s0.body.prefs?.push ?? {}).every(Boolean) && Object.keys(s0.body.prefs?.push ?? {}).length === 9);
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

  // Отказ — только с причиной: продавец видит её в кошельке и в уведомлении.
  const second = await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '30000', method: 'card', destination: '4111111111111111' }) });
  const bare = await j(`/payouts/${second.body.id}/reject`, { method: 'POST', token: fin.token, body: '{}' });
  const why = 'Карта не на ваше имя — укажите свою';
  const rej = await j(`/payouts/${second.body.id}/reject`, { method: 'POST', token: fin.token, body: JSON.stringify({ reason: why }) });
  const mine = (await j('/payouts/mine', { token: seller.token })).body.find((p) => p.id === second.body.id);
  const note = await prisma.notification.findFirst({ where: { userId: seller.id, type: 'payout_rejected' } });
  const wBack = await j('/wallet', { token: seller.token });
  check(
    'Отказ в выводе: без причины — 400; с причиной — деньги на баланс, причина продавцу в заявке и уведомлении',
    bare.status === 400 && bare.body.reason?.[0] === 'Напишите причину отказа — продавец увидит её' &&
      rej.body.status === 'rejected' && mine?.rejectReason === why && note?.payload?.preview === why &&
      wBack.body.balance === '35000' && wBack.body.withdrawing.count === 0,
    JSON.stringify({ bare: bare.body, mine: mine?.rejectReason, note: note?.payload, balance: wBack.body.balance }),
  );

  // Сохранённые реквизиты: запомнить при заявке, в следующий раз — выбрать.
  const third = await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '30000', method: 'card', destination: '4111 1111 1111 1111', save: true }) });
  const kept = (await j('/payouts/destinations', { token: seller.token })).body;
  await j(`/payouts/${third.body.id}/reject`, { method: 'POST', token: fin.token, body: JSON.stringify({ reason: 'Проверка сохранённых реквизитов' }) });
  const again = await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '30000', method: 'card', savedId: kept[0]?.id }) });
  const sameCard = (await j(`/payouts/${again.body.id}/destination`, { token: fin.token })).body;
  check(
    'Реквизиты запомнены: наружу только маска; заявка по сохранённым уходит на ту же карту',
    third.status === 201 && kept.length === 1 && kept[0].method === 'card' && kept[0].hint === '•••• 1111' &&
      !JSON.stringify(kept).includes('4111 1111') && again.status === 201 && again.body.destinationHint === '•••• 1111' &&
      sameCard.destination === '4111 1111 1111 1111',
    JSON.stringify({ kept, again: again.body, dest: sameCard }),
  );
  const othersSee = (await j('/payouts/destinations', { token: buyer.token })).body;
  const othersDelete = await j(`/payouts/destinations/${kept[0]?.id}`, { method: 'DELETE', token: buyer.token });
  const forget = await j(`/payouts/destinations/${kept[0]?.id}`, { method: 'DELETE', token: seller.token });
  const left = (await j('/payouts/destinations', { token: seller.token })).body;
  check(
    'Чужие реквизиты не видны и не удаляются; свои удалены — список пуст',
    Array.isArray(othersSee) && othersSee.length === 0 && othersDelete.status === 404 && forget.status === 200 && left.length === 0,
    JSON.stringify({ others: othersSee, del: othersDelete.status, forget: forget.status, left }),
  );
}

/**
 * Инструменты продавца: приветствие покупателю в новом диалоге (один раз,
 * с пометкой и скрытыми контактами), заготовки ответов, автоподнятие —
 * фоновая задача API (в CI раз в 2 с) поднимает лот сама.
 */
async function scenarioSellerTools(rnd) {
  console.log('\n— Инструменты продавца —');
  const seller = await register('sts', rnd);
  const buyer = await register('stb', rnd);
  const other = await register('sto', rnd);
  const lot = await createListing(seller.token, 'accounts', '90000');

  const fresh = await j('/seller-tools', { token: seller.token });
  check(
    'Настройки по умолчанию: приветствия нет, автоподнятие выключено, пауза 4 ч',
    fresh.body.greeting === null && fresh.body.autoRaise === false && fresh.body.raise?.everyHours === 4 &&
      fresh.body.raise.activeLots === 1 && fresh.body.templates.length === 0,
    JSON.stringify(fresh.body),
  );
  await j('/seller-tools/greeting', {
    method: 'PUT', token: seller.token,
    body: JSON.stringify({ text: 'Здравствуйте. Пишите в телеграм @seller_tg' }),
  });
  const ask = (text) =>
    j(`/conversations/for-listing/${lot}`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: text }) });
  const first = await ask('Аккаунт ещё есть?');
  await ask('Ау');
  const msgs = (await j(`/conversations/${first.body.id}/messages`, { token: buyer.token })).body;
  const auto = msgs.filter((m) => m.auto);
  check(
    'Приветствие: ответ продавца на первое сообщение, один раз, «автоответ», контакт скрыт',
    auto.length === 1 && auto[0].senderId === seller.id && !auto[0].body.includes('@seller_tg') &&
      msgs.indexOf(auto[0]) === msgs.findIndex((m) => m.body === 'Аккаунт ещё есть?') + 1,
    JSON.stringify(msgs.map((m) => [m.senderId === seller.id ? 'seller' : m.senderId ? 'buyer' : 'system', m.auto, m.body])),
  );

  const empty = await j('/seller-tools/templates', { method: 'POST', token: seller.token, body: JSON.stringify({ title: ' ', body: 'x' }) });
  const tpl = await j('/seller-tools/templates', {
    method: 'POST', token: seller.token,
    body: JSON.stringify({ title: 'После оплаты', body: '{имя}, спасибо за покупку' }),
  });
  const foreign = await j(`/seller-tools/templates/${tpl.body.id}`, {
    method: 'PUT', token: other.token, body: JSON.stringify({ title: 'чужая', body: 'чужая' }),
  });
  const list = (await j('/seller-tools/templates', { token: seller.token })).body;
  check(
    'Заготовки: пустое название — 400, чужую не изменить — 404, в списке своя',
    empty.status === 400 && foreign.status === 404 && list.length === 1 && list[0].title === 'После оплаты',
    JSON.stringify({ empty: empty.status, foreign: foreign.status, list }),
  );
  const del = await j(`/seller-tools/templates/${tpl.body.id}`, { method: 'DELETE', token: seller.token });
  check('Заготовка удаляется', del.status === 200 && (await j('/seller-tools/templates', { token: seller.token })).body.length === 0);

  // Команда, как у FunPayCardinal: «!оплата» отдельным сообщением — заготовка уходит сама.
  const cmd = await j('/seller-tools/templates', {
    method: 'POST', token: seller.token,
    body: JSON.stringify({ title: 'Оплата', body: '{имя}, оплата — СБП или картой', command: ' !Оплата ' }),
  });
  const dup = await j('/seller-tools/templates', {
    method: 'POST', token: seller.token,
    body: JSON.stringify({ title: 'Ещё', body: 'x', command: '!ОПЛАТА' }),
  });
  check(
    'Команда хранится в нижнем регистре, повтор у продавца — 400',
    cmd.body.command === '!оплата' && dup.status === 400,
    JSON.stringify({ cmd: cmd.body, dup: dup.body }),
  );
  await ask('Как !оплата?');
  await ask('!ОПЛАТА');
  const withCmd = (await j(`/conversations/${first.body.id}/messages`, { token: buyer.token })).body;
  const replies = withCmd.filter((m) => m.auto && m.body.includes('оплата — СБП'));
  check(
    'Автоответ на команду: только на сообщение целиком, от продавца, с ником покупателя',
    replies.length === 1 && replies[0].senderId === seller.id && replies[0].body.startsWith(`stb${rnd},`) &&
      withCmd.at(-1).id === replies[0].id,
    JSON.stringify(withCmd.slice(-4).map((m) => [m.auto, m.body])),
  );

  // Время ответа: до трёх живых ответов подписи нет, с тремя — «обычно отвечает».
  const quiet = (await j(`/sellers/${seller.id}`)).body;
  for (let i = 1; i <= 3; i++) {
    await ask(`Вопрос ${i}`);
    await j(`/conversations/${first.body.id}/messages`, {
      method: 'POST', token: seller.token, body: JSON.stringify({ body: `Ответ ${i}` }),
    });
  }
  const fast = (await j(`/sellers/${seller.id}`)).body;
  const head = (await j(`/conversations/${first.body.id}`, { token: buyer.token })).body;
  const mine = (await j(`/conversations/${first.body.id}`, { token: seller.token })).body;
  check(
    'Время ответа: после трёх ответов — «за 5 минут» в профиле и в чате покупателя',
    quiet.replyTime === null && fast.replyTime === 'min5' && head.counterpart?.replyTime === 'min5' &&
      mine.counterpart?.replyTime === null,
    JSON.stringify({ quiet: quiet.replyTime, fast: fast.replyTime, head: head.counterpart, mine: mine.counterpart }),
  );

  // Лот поднимали 5 часов назад — пауза новичка (4 ч) прошла.
  const old = new Date(Date.now() - 5 * 3600_000 + 24 * 3600_000);
  await prisma.listing.update({ where: { id: lot }, data: { boostUntil: old } });
  const on = await j('/seller-tools/auto-raise', { method: 'PUT', token: seller.token, body: JSON.stringify({ on: true }) });
  let raised = null;
  for (let i = 0; i < 20 && !raised; i++) {
    await wait(500);
    const l = await prisma.listing.findUnique({ where: { id: lot }, select: { boostUntil: true } });
    if (l.boostUntil > old) raised = l.boostUntil;
  }
  check(
    'Автоподнятие: лот поднялся сам, как только прошла пауза',
    on.body.autoRaise === true && raised !== null,
    JSON.stringify({ on: on.body, raised }),
  );
  const status = (await j('/seller-tools', { token: seller.token })).body.raise;
  check('После поднятия — следующее через ~4 ч', status.nextInMinutes > 230 && status.nextInMinutes <= 240, JSON.stringify(status));
}

/**
 * Отчёты: выписка по балансу сходится с балансом, файлы для Excel (BOM,
 * «;» по-русски, «,» по-английски), продажи за период, сводка площадки —
 * только финансам.
 */
async function scenarioReports(rnd) {
  console.log('\n— Отчёты: выписка, продажи, сводка —');
  const seller = await register('rps', rnd);
  const buyer = await register('rpb', rnd);
  const fin = await register('rpf', rnd);
  await grant(fin.id, 'finance');
  const listingId = await createListing(seller.token, 'accounts', '120000');
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  await pay(buyer.token, order.body.id);
  await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
  await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });
  const payout = order.body.sellerPayoutAmount;
  await j('/payouts', { method: 'POST', token: seller.token, body: JSON.stringify({ amount: '50000', method: 'usdt', destination: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE' }) });

  const st = (await j('/reports/statement', { token: seller.token })).body;
  const wallet = (await j('/wallet', { token: seller.token })).body;
  const sale = st.rows?.find((r) => r.refType === 'order_release');
  check(
    'Выписка: продажа с номером заказа, заявка на вывод; остаток на конец = баланс',
    st.opening === '0' && sale?.orderNumber === order.body.publicNumber && sale.amount === payout &&
      st.rows[0].refType === 'payout_hold' && st.rows[0].amount === '-50000' && st.closing === wallet.balance &&
      st.sales.count === 1 && st.sales.payout === payout,
    JSON.stringify({ closing: st.closing, balance: wallet.balance, rows: st.rows?.map((r) => [r.refType, r.amount, r.balance]) }),
  );

  const file = async (path, token, lang = 'ru') => {
    const res = await fetch(`${API}/api${path}`, { headers: { Authorization: `Bearer ${token}`, 'Accept-Language': lang } });
    // text() срезал бы BOM — читаем байты как есть.
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await res.arrayBuffer());
    return { status: res.status, type: res.headers.get('content-type'), disp: res.headers.get('content-disposition'), text };
  };
  const csv = await file('/reports/statement.csv', seller.token);
  check(
    'Выписка файлом: Excel-CSV с BOM и «;», операция и заказ, остатки внизу',
    csv.status === 200 && /^text\/csv/.test(csv.type) && /attachment; filename="gamemarket-statement-/.test(csv.disp) &&
      csv.text.startsWith('\uFEFFДата (МСК);Операция;Заказ;Приход;Расход;Остаток') &&
      csv.text.includes(`Зачисление за продажу;${order.body.publicNumber};`) && csv.text.includes('Остаток на конец'),
    csv.text.slice(0, 300),
  );
  const en = await file('/reports/statement.csv', seller.token, 'en');
  check('По-английски — заголовки и «,»', en.text.startsWith('\uFEFFDate (Moscow time),Transaction,Order,In,Out,Balance') && en.text.includes('Sale proceeds'), en.text.slice(0, 120));
  const sales = await file('/reports/sales.csv', seller.token);
  const amount = (minor) => `${BigInt(minor) / 100n},${String(BigInt(minor) % 100n).padStart(2, '0')}`;
  check(
    'Продажи файлом: заказ, лот, покупатель, суммы; итог',
    sales.text.includes(`${order.body.publicNumber};E2E accounts;rpb${rnd};1;${amount(order.body.amount)};`) &&
      sales.text.includes(`Итого;1;;;;${amount(order.body.amount)};`),
    sales.text.slice(0, 400),
  );
  const old = (await j('/reports/statement?from=2020-01-01&to=2020-01-31', { token: seller.token })).body;
  const bad = await j('/reports/statement?from=21.10.2026', { token: seller.token });
  check('Прошлый период — пусто; неверная дата — 400', old.rows?.length === 0 && old.closing === '0' && bad.status === 400, JSON.stringify({ rows: old.rows?.length, bad: bad.status }));

  // «Кошелёк»: деньги в пути — выданная, но не подтверждённая продажа и заявка на вывод.
  const open = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: await createListing(seller.token, 'accounts', '80000') }) });
  await pay(buyer.token, open.body.id);
  await j(`/orders/${open.body.id}/deliver`, { method: 'POST', token: seller.token });
  const w = (await j('/wallet', { token: seller.token })).body;
  check(
    'Кошелёк: в сделках — выданная продажа до подтверждения, на выводе — заявка',
    w.balance === wallet.balance && w.inDeals?.count === 1 && w.inDeals.amount === open.body.sellerPayoutAmount &&
      w.withdrawing?.count === 1 && w.withdrawing.amount === '50000',
    JSON.stringify(w),
  );
  const onlySales = (await j('/reports/statement?kind=sales', { token: seller.token })).body;
  const onlyPayouts = (await j('/reports/statement?kind=payouts', { token: seller.token })).body;
  check(
    'Выписка по типу: только продажи или только выводы, их суммы; итоги — по балансу',
    onlySales.total === 1 && onlySales.rows?.[0]?.refType === 'order_release' && onlySales.shown?.credits === payout &&
      onlyPayouts.total === 1 && onlyPayouts.rows?.[0]?.amount === '-50000' && onlyPayouts.shown?.debits === '50000' &&
      onlyPayouts.closing === st.closing,
    JSON.stringify({ sales: onlySales.rows?.map((r) => r.refType), payouts: onlyPayouts.shown }),
  );
  const page1 = (await j('/reports/statement?limit=1', { token: seller.token })).body;
  const page2 = (await j('/reports/statement?limit=1&offset=1', { token: seller.token })).body;
  check(
    'Выписка по страницам: новые сверху, «ещё» — пока есть',
    page1.rows?.length === 1 && page1.more === true && page1.rows[0].refType === 'payout_hold' &&
      page2.rows?.length === 1 && page2.rows[0].id !== page1.rows[0].id && page2.more === false,
    JSON.stringify({ p1: page1.rows?.map((r) => r.refType), p2: page2.rows?.map((r) => r.refType), more: [page1.more, page2.more] }),
  );
  const kindCsv = await file('/reports/statement.csv?kind=payouts', seller.token);
  const badKind = await j('/reports/statement?kind=salary', { token: seller.token });
  check(
    'Выписка файлом по типу: только выводы, тип в имени файла; неизвестный тип — 400',
    /filename="gamemarket-statement-payouts-/.test(kindCsv.disp) && kindCsv.text.includes('Заявка на вывод;') &&
      !kindCsv.text.includes('Зачисление за продажу') && kindCsv.text.includes('Остаток на конец') &&
      badKind.status === 400 && badKind.body.kind?.[0] === 'Нет такого типа операций',
    JSON.stringify({ disp: kindCsv.disp, bad: badKind.body }),
  );

  // «Заказы» в кабинете: новые сверху по страницам, поиск по номеру, лоту и нику, период.
  const hist = (qs, token = seller.token) => j(`/orders/history?${qs}`, { token });
  const sales2 = (await hist('role=seller')).body;
  const p1 = (await hist('role=seller&limit=1')).body;
  const p2 = (await hist(`role=seller&limit=1&before=${p1.next}`)).body;
  check(
    'Заказы: продажи новыми сверху с ником покупателя; по страницам от последнего показанного',
    sales2.items?.length === 2 && sales2.next === null && sales2.items[0].id === open.body.id &&
      sales2.items[0].counterparty === `rpb${rnd}` && sales2.items[0].title === 'E2E accounts' &&
      p1.items?.length === 1 && p1.next === open.body.id && p2.items?.[0]?.id === order.body.id && p2.next === null,
    JSON.stringify({ all: sales2.items?.map((o) => [o.publicNumber, o.status]), p1: p1.next, p2: p2.items?.map((o) => o.publicNumber) }),
  );
  const byNick = (await hist(`role=seller&q=${encodeURIComponent(`@RPB${rnd}`)}`)).body;
  const byNumber = (await hist(`role=seller&q=${encodeURIComponent(`#${order.body.publicNumber.toLowerCase()}`)}`)).body;
  const byTitle = (await hist('role=seller&q=e2e%20acc&status=completed&days=1')).body;
  const none = (await hist('role=seller&q=nothing-like-this')).body;
  check(
    'Заказы: поиск по нику с «@», номеру с «#» без учёта регистра и по лоту со статусом и периодом',
    byNick.items?.length === 2 && byNumber.items?.length === 1 && byNumber.items[0].id === order.body.id &&
      byTitle.items?.length === 1 && byTitle.items[0].status === 'completed' && none.items?.length === 0,
    JSON.stringify({ nick: byNick.items?.length, number: byNumber.items?.length, title: byTitle.items?.length, none: none.items?.length }),
  );
  const bought = (await hist('role=buyer', buyer.token)).body;
  const wrongSide = await hist(`role=seller&before=${order.body.id}`, buyer.token);
  const anon = await j('/orders/history?role=buyer');
  check(
    'Заказы: покупателю — его покупки с ником продавца; своя покупка курсором в продажи — 400; без входа — 401',
    bought.items?.length === 2 && bought.items.every((o) => o.role === 'buyer' && o.counterparty === `rps${rnd}`) &&
      wrongSide.status === 400 && /Список заказов устарел/.test(wrongSide.body.message) && anon.status === 401,
    JSON.stringify({ bought: bought.items?.map((o) => o.counterparty), wrong: wrongSide.body, anon: anon.status }),
  );

  const denied = await j('/reports/platform', { token: seller.token });
  const sum = (await j('/reports/platform?days=7', { token: fin.token })).body;
  const dailyGmv = (sum.daily ?? []).reduce((a, d) => a + BigInt(d.gmv), 0n);
  check(
    'Сводка — только финансам; оборот по дням сходится с итогом, сделка в нём есть',
    denied.status === 403 && sum.daily?.length === 7 && dailyGmv === BigInt(sum.gmv) &&
      BigInt(sum.gmv) >= BigInt(order.body.amount) && sum.orders.completed >= 1 && BigInt(sum.revenue) > 0n &&
      sum.payouts.pendingCount >= 1,
    JSON.stringify({ denied: denied.status, gmv: sum.gmv, revenue: sum.revenue, days: sum.daily?.length, orders: sum.orders }),
  );
  const pcsv = await file('/reports/platform.csv?days=7', fin.token);
  check('Сводка файлом', pcsv.status === 200 && pcsv.text.startsWith('\uFEFFДень;Сделок завершено;Оборот;Доход площадки'), pcsv.text.slice(0, 120));
}

/**
 * «Отзывы» в кабинете: полученные с фильтром «без ответа» и ответом прямо
 * из списка, оставленные — со сроком правки.
 */
async function scenarioMyReviews(rnd) {
  console.log('\n— «Отзывы» в кабинете —');
  const seller = await register('mrs', rnd);
  const buyer = await register('mrb', rnd);
  const deal = async (price, rating, comment) => {
    const listingId = await createListing(seller.token, 'accounts', price);
    const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
    await pay(buyer.token, order.body.id);
    await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
    await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });
    const r = await j('/reviews', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, rating, comment }) });
    return r.body;
  };
  const first = await deal('30000', 5, 'Быстро и честно');
  const second = await deal('40000', 3, 'Долго ждал выдачи');
  const mine = (token, q = '') => j(`/reviews/mine?${q}`, { token });
  const received = await mine(seller.token, 'tab=received');
  const open = await mine(seller.token, 'tab=received&unanswered=1');
  const written = await mine(buyer.token, 'tab=written');
  const strangerView = await mine(buyer.token, 'tab=received');
  check(
    '«Отзывы»: продавцу — полученные с ником покупателя, оба без ответа; покупателю — оставленные с правкой; чужих нет',
    received.body.items?.map((r) => r.id).join() === `${second.id},${first.id}` && received.body.items[0].counterpart === `mrb${rnd}` &&
      open.body.items.length === 2 && received.body.counts.unanswered === 2 &&
      written.body.items?.[0]?.counterpart === `mrs${rnd}` && written.body.items[0].editable === true &&
      strangerView.body.items.length === 0 && (await j('/reviews/mine')).status === 401,
    JSON.stringify({ received: received.body.counts, written: written.body.items?.map((r) => [r.counterpart, r.editable]) }),
  );
  await j(`/reviews/${second.id}/reply`, { method: 'POST', token: seller.token, body: JSON.stringify({ text: 'Извините, выдал быстрее в следующий раз' }) });
  const after = await mine(seller.token, 'tab=received&unanswered=1');
  const buyerSees = await mine(buyer.token, 'tab=written');
  check(
    '«Отзывы»: ответ уводит отзыв из «без ответа», покупатель видит ответ в оставленных',
    after.body.items.map((r) => r.id).join() === first.id && after.body.counts.unanswered === 1 &&
      buyerSees.body.items.find((r) => r.id === second.id)?.sellerReply === 'Извините, выдал быстрее в следующий раз',
    JSON.stringify({ after: after.body.counts, reply: buyerSees.body.items?.map((r) => r.sellerReply) }),
  );
}

/**
 * Страница «Уведомления»: вся история новыми сверху, дальше — по последнему
 * показанному, группы со счётчиками непрочитанных, «Прочитать все» в группе.
 */
async function scenarioNotificationsPage(rnd) {
  console.log('\n— Страница «Уведомления» —');
  const u = await register('ntf', rnd);
  const other = await register('ntg', rnd);
  const base = Date.now() - 3600_000;
  const types = ['order_paid', 'dispute_opened', 'new_message', 'review_received', 'order_delivered', 'new_login'];
  await prisma.notification.createMany({
    data: types.map((type, i) => ({ userId: u.id, type, payload: { preview: `#${i}` }, createdAt: new Date(base + i * 1000) })),
  });
  const foreign = await prisma.notification.create({ data: { userId: other.id, type: 'order_paid', payload: {} } });
  const h = (q) => j(`/notifications/history?${q}`, { token: u.token });
  const p1 = await h('limit=2');
  const p2 = await h(`limit=2&before=${p1.body.next}`);
  const p3 = await h(`limit=2&before=${p2.body.next}`);
  const kinds = (p) => (p.body.items ?? []).map((n) => n.type).join(',');
  check(
    'Уведомления: вся история новыми сверху по страницам, без сообщений; непрочитанные по группам',
    kinds(p1) === 'new_login,order_delivered' && kinds(p2) === 'review_received,dispute_opened' && kinds(p3) === 'order_paid' &&
      p3.body.next === null && p1.body.unread.total === 5 &&
      Object.entries({ orders: 2, disputes: 1, reviews: 1, security: 1 }).every(([g, n]) => p1.body.unread.groups[g] === n) &&
      Object.keys(p1.body.unread.groups).length === 4,
    JSON.stringify({ p1: kinds(p1), p2: kinds(p2), p3: kinds(p3), unread: p1.body.unread }),
  );
  const orders = await h('group=orders');
  const stranger = await h(`before=${foreign.id}`);
  const messages = await h('group=messages');
  const guest = await j('/notifications/history');
  check(
    'Уведомления: группа «Заказы»; чужой курсор и группа сообщений — 400; без входа — 401',
    kinds(orders) === 'order_delivered,order_paid' && stranger.status === 400 && messages.status === 400 && guest.status === 401,
    JSON.stringify({ orders: kinds(orders), stranger: stranger.status, messages: messages.status, guest: guest.status }),
  );
  const readOrders = await j('/notifications/read-all?group=orders', { method: 'POST', token: u.token });
  const unreadOrders = await h('group=orders&unread=1');
  const unreadAll = await h('unread=1');
  const foreignAfter = await prisma.notification.findUnique({ where: { id: foreign.id } });
  check(
    'Уведомления: «Прочитать все» в группе — только в ней и только свои',
    readOrders.body.unread?.total === 3 && kinds(unreadOrders) === '' && kinds(unreadAll) === 'new_login,review_received,dispute_opened' &&
      foreignAfter.readAt === null,
    JSON.stringify({ unread: readOrders.body.unread, unreadAll: kinds(unreadAll) }),
  );
}

/**
 * Споры: срок ответа второй стороны, запрос арбитра, напоминание за 3 часа
 * до конца срока и спор в сводке для плашки на сайте, пропущенный срок
 * (фоновая задача API, в CI раз в 2 с), закрытие спора покупателем без
 * претензий и возврат денег продавцом из спора.
 */
async function scenarioDisputes(rnd) {
  console.log('\n— Споры: сроки ответа и мирное закрытие —');
  const seller = await register('dss', rnd);
  const buyer = await register('dsb', rnd);
  const agent = await register('dsa', rnd);
  await grant(agent.id, 'agent');
  const deal = async (price) => {
    const listingId = await createListing(seller.token, 'accounts', price);
    const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
    await pay(buyer.token, order.body.id);
    await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
    const d = await j('/disputes', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, reason: 'Данные от аккаунта не подходят' }) });
    return { order: order.body, dispute: d.body };
  };
  const view = async (id, token = buyer.token) => (await j(`/disputes/${id}`, { token })).body;

  const a = await deal('80000');
  let v = await view(a.dispute.id);
  const left = (Date.parse(v.dispute.respondBy) - Date.now()) / 3600_000;
  check('Открыт спор — ход за продавцом, 24 часа на ответ', v.dispute.awaitingFrom === 'seller' && left > 23.9 && left <= 24 && v.side === 'buyer', JSON.stringify({ awaiting: v.dispute.awaitingFrom, left }));
  await j(`/disputes/${a.dispute.id}/messages`, { method: 'POST', token: seller.token, body: JSON.stringify({ body: 'Данные верные, проверьте ещё раз' }) });
  v = await view(a.dispute.id);
  check('Продавец ответил — срок снят', v.dispute.awaitingFrom === null && v.dispute.respondBy === null);

  const ask = await j(`/disputes/${a.dispute.id}/request`, { method: 'POST', token: agent.token, body: JSON.stringify({ side: 'buyer' }) });
  const denied = await j(`/disputes/${a.dispute.id}/request`, { method: 'POST', token: seller.token, body: JSON.stringify({ side: 'buyer' }) });
  const notes = (await j('/notifications', { token: buyer.token })).body;
  const list = Array.isArray(notes) ? notes : (notes.items ?? []);
  check(
    'Арбитр просит пояснений у покупателя: срок и уведомление; продавцу запрашивать нельзя',
    ask.body.awaitingFrom === 'buyer' && ask.body.status === 'in_review' && denied.status === 403 &&
      list.some((n) => n.type === 'dispute_reply_needed'),
    JSON.stringify({ ask: ask.body.awaitingFrom, denied: denied.status, types: list.map((n) => n.type) }),
  );

  // «Споры» в кабинете: у каждого — со своей стороны, ход за покупателем; постороннему — пусто.
  const mine = async (token, state = 'open') => (await j(`/disputes/mine?state=${state}`, { token })).body;
  const buyerMine = await mine(buyer.token);
  const sellerMine = await mine(seller.token);
  const strangerMine = await mine(agent.token);
  const bm = buyerMine.items?.find((d) => d.id === a.dispute.id);
  const sm = sellerMine.items?.find((d) => d.id === a.dispute.id);
  check(
    '«Споры» в кабинете: покупатель и продавец видят спор со своей стороны, ход — за покупателем; постороннему — пусто',
    bm?.side === 'buyer' && bm.myTurn === true && bm.counterpart === `dss${rnd}` && bm.order.publicNumber === a.order.publicNumber &&
      sm?.side === 'seller' && sm.myTurn === false && sm.counterpart === `dsb${rnd}` &&
      buyerMine.counts.myTurn === 1 && sellerMine.counts.myTurn === 0 && strangerMine.items.length === 0,
    JSON.stringify({ bm, sm: sm && { side: sm.side, myTurn: sm.myTurn }, counts: [buyerMine.counts, sellerMine.counts], stranger: strangerMine.items?.length }),
  );
  // Спор, где ждут ответа покупателя, — в его сводке (плашка на сайте), у продавца — нет.
  const summary = async (token) => (await j('/account/summary', { token })).body.dispute;
  const inSummary = await summary(buyer.token);
  const sellerSummary = await summary(seller.token);
  // За 2 часа до конца срока — одно напоминание покупателю, повторы фоновой задачи его не дублируют.
  await prisma.dispute.update({ where: { id: a.dispute.id }, data: { respondBy: new Date(Date.now() + 2 * 3600_000) } });
  const reminders = async () => {
    const r = (await j('/notifications', { token: buyer.token })).body;
    return (Array.isArray(r) ? r : (r.items ?? [])).filter((n) => n.type === 'dispute_reply_soon' && n.payload?.disputeId === a.dispute.id);
  };
  let soon = [];
  for (let i = 0; i < 20 && !soon.length; i++) {
    await wait(500);
    soon = await reminders();
  }
  await wait(4500);
  const soonAfter = await reminders();
  const sellerSoon = (await j('/notifications', { token: seller.token })).body;
  check(
    'Срок подходит к концу — одно напоминание тому, чей ход, со ссылкой на спор; спор в сводке для плашки',
    inSummary?.id === a.dispute.id && inSummary.orderNumber === a.order.publicNumber && sellerSummary === null &&
      soon.length === 1 && soonAfter.length === 1 && soon[0].payload.preview.startsWith(a.order.publicNumber) &&
      !(Array.isArray(sellerSoon) ? sellerSoon : (sellerSoon.items ?? [])).some((n) => n.type === 'dispute_reply_soon'),
    JSON.stringify({ inSummary, sellerSummary, soon: soon.map((n) => n.payload), again: soonAfter.length }),
  );

  await prisma.dispute.update({ where: { id: a.dispute.id }, data: { respondBy: new Date(Date.now() - 1000) } });
  let missed = null;
  for (let i = 0; i < 20 && !missed; i++) {
    await wait(500);
    const d = await prisma.dispute.findUnique({ where: { id: a.dispute.id } });
    // Отметка и сообщение площадки пишутся друг за другом — ждём обоих.
    const noted = await prisma.disputeMessage.count({ where: { disputeId: a.dispute.id, senderId: null, body: { startsWith: 'Покупатель не ответил' } } });
    if (d.missedBy && noted) missed = d;
  }
  v = await view(a.dispute.id, agent.token);
  const queue = (await j('/disputes/queue', { token: agent.token })).body;
  // Наверху — только споры, где кто-то промолчал (в общей базе они бывают и от других прогонов).
  const at = queue.findIndex((q) => q.id === a.dispute.id);
  const raised = at >= 0 && queue.slice(0, at).every((q) => q.missedBy);
  check(
    'Срок прошёл — «покупатель не ответил» сообщением площадки, спор поднят в очереди; деньги на месте',
    missed?.missedBy === 'buyer' && v.messages.some((m) => m.senderId === null && /Покупатель не ответил в срок/.test(m.body)) &&
      raised && v.order.status === 'disputed',
    JSON.stringify({ missed: missed?.missedBy, at, raised, status: v.order?.status }),
  );
  check('Срок прошёл — спор ушёл из сводки, плашки больше нет', (await summary(buyer.token)) === null);

  const balanceBefore = BigInt((await j('/wallet', { token: seller.token })).body.balance);
  const sellerTry = await j(`/disputes/${a.dispute.id}/withdraw`, { method: 'POST', token: seller.token });
  const closed = await j(`/disputes/${a.dispute.id}/withdraw`, { method: 'POST', token: buyer.token });
  const again = await j(`/disputes/${a.dispute.id}/withdraw`, { method: 'POST', token: buyer.token });
  v = await view(a.dispute.id);
  const balanceAfter = BigInt((await j('/wallet', { token: seller.token })).body.balance);
  check(
    'Покупатель закрыл спор без претензий — сделка завершена, деньги у продавца; повтор — 409, продавцу — 403',
    sellerTry.status === 403 && closed.status === 201 && again.status === 409 && v.dispute.status === 'cancelled' &&
      v.order.status === 'completed' && balanceAfter - balanceBefore === BigInt(a.order.sellerPayoutAmount),
    JSON.stringify({ sellerTry: sellerTry.status, closed: closed.status, again: again.status, status: v.dispute.status, delta: String(balanceAfter - balanceBefore) }),
  );
  const openNow = await mine(buyer.token);
  const closedNow = await mine(buyer.token, 'closed');
  check(
    '«Споры» в кабинете: закрытый спор ушёл из открытых во «Закрытые»',
    !openNow.items.some((d) => d.id === a.dispute.id) && closedNow.items[0]?.id === a.dispute.id &&
      closedNow.items[0].status === 'cancelled' && closedNow.counts.closed === 1,
    JSON.stringify({ open: openNow.counts, closed: closedNow.items?.map((d) => d.status) }),
  );

  const b = await deal('60000');
  const refund = await j(`/orders/${b.order.id}/refund`, { method: 'POST', token: seller.token, body: JSON.stringify({}) });
  v = await view(b.dispute.id);
  check(
    'Продавец вернул деньги из спора — спор закрыт в пользу покупателя, сообщение площадки, без «комментария арбитра»',
    refund.status === 201 && v.dispute.status === 'resolved_buyer' && v.dispute.resolutionNote === null &&
      v.messages.some((m) => m.senderId === null && /Продавец вернул деньги/.test(m.body)),
    JSON.stringify({ refund: refund.status, status: v.dispute.status, note: v.dispute.resolutionNote }),
  );
}

/**
 * Отзыв с фото: загрузка через API, в отзыв — только свои фото, на витрине —
 * адреса и фильтр «С фото», фото открывается без входа.
 */
async function scenarioReviewPhotos(rnd) {
  console.log('\n— Отзывы с фото —');
  const seller = await register('rvs', rnd);
  const buyer = await register('rvb', rnd);
  const other = await register('rvo', rnd);
  const listingId = await createListing(seller.token, 'accounts', '70000');
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
  await pay(buyer.token, order.body.id);
  await j(`/orders/${order.body.id}/deliver`, { method: 'POST', token: seller.token });
  await j(`/orders/${order.body.id}/confirm`, { method: 'POST', token: buyer.token });

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = async (token, body = png, type = 'image/png') => {
    const form = new FormData();
    form.append('file', new Blob([body], { type }), 'shot.png');
    const res = await fetch(`${API}/api/reviews/uploads`, { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const mine = await upload(buyer.token);
  const foreign = await upload(other.token);
  const text = await upload(buyer.token, Buffer.from('not an image'), 'text/plain');
  const review = (images) =>
    j('/reviews', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.body.id, rating: 5, comment: 'Всё как в описании', images }) });
  const stolen = await review([foreign.body?.key]);
  const ok = await review([mine.body?.key]);
  check(
    'Фото к отзыву: своё — принято, чужое — 400, не картинка — 400',
    mine.status === 201 && mine.body.key?.startsWith(`reviews/${buyer.id}/`) && text.status === 400 &&
      stolen.status === 400 && ok.status === 201 && ok.body.photoCount === 1,
    JSON.stringify({ mine: mine.status, text: text.status, stolen: stolen.status, ok: ok.status }),
  );
  const list = (await j(`/reviews/user/${seller.id}?photos=1`)).body;
  const profile = (await j(`/sellers/${seller.id}`)).body;
  // Без PUBLIC_ASSET_BASE адрес относительный — как его и показывает сайт.
  const url = list[0]?.images?.[0];
  const pic = url ? await fetch(url.startsWith('http') ? url : `${API}${url}`) : null;
  check(
    'На витрине: фильтр «С фото», адрес фото открывается без входа, счётчик в профиле',
    list.length === 1 && pic?.status === 200 && pic.headers.get('content-type') === 'image/png' && profile.photoReviews === 1,
    JSON.stringify({ list: list.length, pic: pic?.status, photos: profile.photoReviews }),
  );
  const edited = await j(`/reviews/${ok.body.id}`, { method: 'PATCH', token: buyer.token, body: JSON.stringify({ images: [] }) });
  const gone = await fetch(`${API}/api/assets?key=${encodeURIComponent(mine.body.key)}`);
  const none = (await j(`/reviews/user/${seller.id}?photos=1`)).body;
  check('Фото убрано из отзыва — пропало с витрины и из хранилища', edited.status === 200 && none.length === 0 && gone.status === 404, JSON.stringify({ edited: edited.status, gone: gone.status }));
}

/**
 * Защита перед запуском: заголовки, CORS только для сайта, лимит запросов
 * с адреса. Адрес покупателя приходит в X-Forwarded-For — API верит ему
 * от локального прокси, как за ingress.
 */
/**
 * Сохранённые поиски: условия раздела и «цена до»; новый подходящий лот —
 * уведомление один раз, свой лот и лоты до сохранения — нет, снятый и
 * вернувшийся — не повторяется, без уведомлений — молчит.
 */
async function scenarioSavedSearches(rnd) {
  console.log('\n— Сохранённые поиски —');
  const buyer = await register('ssb', rnd);
  const seller = await register('sss', rnd);
  const other = await register('sso', rnd);
  const word = `ss${rnd}`;
  const lot = (token, price, attrs = {}) =>
    createListing(token, 'accounts', price, {
      title: `Аккаунт ${word}`,
      attributes: { ...REQUIRED_ATTRS.accounts, ...attrs },
    });
  const game = await j('/catalog/games/cs2');
  const cat = game.body.categories.find((c) => c.slug === 'accounts');
  const before = await lot(seller.token, '110000'); // выставлен до сохранения — не новый

  const save = (body, token = buyer.token) =>
    j('/saved-searches', { method: 'POST', token, body: JSON.stringify(body) });
  const terms = { categoryId: cat.id, attrs: { rank: 'Global Elite' }, q: word, maxPrice: 150000 };
  const s = await save(terms);
  const dup = await save({ ...terms, q: word.toUpperCase() });
  const bad = await save({ categoryId: cat.id, attrs: { rank: 'Нет такого' } });
  check(
    'Поиск сохранён: ссылка на раздел с условиями; повтор и чужой фильтр — 400',
    s.status === 201 && s.body.path === `/igra/cs2/accounts?f_rank=Global%20Elite&q=${word}&max=1500` &&
      s.body.labels?.rank && dup.status === 400 && bad.status === 400,
    JSON.stringify({ s: s.body, dup: dup.status, bad: bad.status }),
  );

  const hits = async () =>
    (await j('/notifications', { token: buyer.token })).body.filter((n) => n.type === 'saved_search');
  const waitHits = async (n) => {
    for (let i = 0; i < 20; i++) {
      const list = await hits();
      if (list.length >= n) return list;
      await wait(500);
    }
    return hits();
  };
  await lot(buyer.token, '100000'); // свой лот — не уведомляет
  await lot(seller.token, '200000'); // дороже — нет
  await lot(seller.token, '100000', { rank: 'Silver' }); // другое звание — нет
  const fit = await lot(seller.token, '120000');
  const first = await waitHits(1);
  await wait(2500); // ещё один-два прохода — повтора нет
  const still = await hits();
  check(
    'Новый подходящий лот — одно уведомление со ссылкой на него; свой, дорогой, другой и старый — нет',
    first.length === 1 && still.length === 1 && first[0].payload.listingId === fit &&
      first[0].payload.count === 1 && !JSON.stringify(still).includes(before),
    JSON.stringify(still.map((n) => n.payload)),
  );

  // Снят и вернулся — уже присылали; второй подходящий — новое уведомление.
  await j(`/listings/${fit}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ status: 'paused' }) });
  await j(`/listings/${fit}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ status: 'active' }) });
  const fit2 = await lot(seller.token, '140000');
  const second = await waitHits(2);
  await wait(2500);
  const after = await hits();
  check(
    'Вернувшийся лот не повторяется, следующий подходящий — новое уведомление',
    after.length === 2 && second.some((n) => n.payload.listingId === fit2),
    JSON.stringify(after.map((n) => n.payload)),
  );

  // Без уведомлений — молчит.
  const off = await j(`/saved-searches/${s.body.id}`, {
    method: 'PATCH', token: buyer.token, body: JSON.stringify({ notify: false }),
  });
  await lot(seller.token, '130000');
  await wait(3000);
  const quiet = await hits();
  const mine = (await j('/saved-searches', { token: buyer.token })).body;
  const foreign = await j(`/saved-searches/${s.body.id}`, { method: 'DELETE', token: other.token });
  const del = await j(`/saved-searches/${s.body.id}`, { method: 'DELETE', token: buyer.token });
  const left = (await j('/saved-searches', { token: buyer.token })).body;
  check(
    'Уведомления выключены — молчит; в списке время последнего лота; чужой не удалить, свой — да',
    off.body.notify === false && quiet.length === 2 && mine[0]?.lastHitAt && foreign.status === 404 &&
      del.status === 200 && left.length === 0,
    JSON.stringify({ off: off.body?.notify, quiet: quiet.length, mine: mine[0], foreign: foreign.status, del: del.status }),
  );
}

/**
 * Снижение цены в избранном: меньше 5% — молчит, 5% и больше — одно
 * уведомление «было — стало»; подорожал и вернулся к прежней — не повод,
 * новый минимум — снова уведомление; «было» в избранном.
 */
async function scenarioPriceDrop(rnd) {
  console.log('\n— Снижение цены в избранном —');
  const buyer = await register('pdb', rnd);
  const seller = await register('pds', rnd);
  const lot = await createListing(seller.token, 'accounts', '100000', { title: `Лот pd${rnd}` });
  await j('/favorites', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  const price = (p) =>
    j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ price: p }) });
  const drops = async () =>
    (await j('/notifications', { token: buyer.token })).body.filter((n) => n.type === 'price_drop');
  const waitDrops = async (n) => {
    for (let i = 0; i < 20; i++) {
      const list = await drops();
      if (list.length >= n) return list;
      await wait(500);
    }
    return drops();
  };

  await price('97000'); // −3% — не повод
  await wait(3000);
  const small = await drops();
  await price('90000'); // −10% от цены при добавлении
  const first = await waitDrops(1);
  check(
    'Подешевел меньше чем на 5% — молчит, на 10% — уведомление «было 1 000, стало 900»',
    small.length === 0 && first.length === 1 && first[0].payload.listingId === lot &&
      first[0].payload.oldPrice === '100000' && first[0].payload.newPrice === '90000' &&
      /1\s000 ₽, стало 900 ₽/.test(first[0].payload.preview),
    JSON.stringify({ small: small.length, first: first.map((n) => n.payload) }),
  );

  await price('120000'); // подорожал
  await price('88000'); // −2% от 900 — не повод
  await wait(3000);
  const back = await drops();
  await price('80000'); // новый минимум: −11% от 900
  const second = await waitDrops(2);
  const favs = (await j('/favorites', { token: buyer.token })).body;
  check(
    'Подорожал и чуть дешевле прежнего — молчит; новый минимум — уведомление; в избранном «было 1 000 ₽»',
    back.length === 1 && second.length === 2 && second.some((n) => n.payload.newPrice === '80000') &&
      favs.find((f) => f.id === lot)?.wasPrice === '100000',
    JSON.stringify({ back: back.length, second: second.map((n) => n.payload), fav: favs.find((f) => f.id === lot) }),
  );
}

/**
 * Статистика лотов: просмотр считается у видимого лота и не у продавца,
 * не трогает updated_at; статистика — просмотры, избранное, покупки,
 * конверсия, график одного лота; чужой лот — 404, только продавцу.
 */
async function scenarioLotStats(rnd) {
  console.log('\n— Статистика лотов —');
  const seller = await register('lss', rnd);
  const buyer = await register('lsb', rnd);
  const a = await createListing(seller.token, 'accounts', '100000', { title: `Статистика A ${rnd}` });
  const b = await createListing(seller.token, 'accounts', '50000', { title: `Статистика B ${rnd}` });
  const c = await createListing(seller.token, 'accounts', '70000', { title: `Статистика C ${rnd}` });
  await j(`/listings/${c}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ status: 'paused' }) });
  const before = await prisma.listing.findUnique({ where: { id: a }, select: { updatedAt: true } });

  const view = (id, token) => j(`/lot-stats/${id}/view`, { method: 'POST', ...(token ? { token } : {}) });
  const v1 = await view(a);
  await view(a);
  await view(a, buyer.token);
  const own = await view(a, seller.token);
  const hidden = await view(c);
  const after = await prisma.listing.findUnique({ where: { id: a }, select: { updatedAt: true, viewsCount: true } });
  check(
    'Просмотр: гость и покупатель — да, продавец и снятый лот — нет; updated_at лота не меняется',
    v1.status === 200 && v1.body.counted === true && own.body.counted === false &&
      hidden.body.counted === false && after.viewsCount === 3 &&
      after.updatedAt.getTime() === before.updatedAt.getTime(),
    JSON.stringify({ v1: v1.body, own: own.body, hidden: hidden.body, views: after.viewsCount }),
  );

  await j('/favorites', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: a }) });
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: b }) });
  await pay(buyer.token, order.body.id);

  const s = await j('/lot-stats?days=7', { token: seller.token });
  const row = (id) => s.body.lots?.find((l) => l.id === id);
  check(
    'Статистика: просмотры, избранное, покупки и конверсия по лотам; итог и сегодняшний день',
    s.status === 200 && row(a)?.views === 3 && row(a)?.favorites === 1 && row(a)?.purchases === 0 &&
      row(a)?.conversion === 0 && row(b)?.purchases === 1 && row(b)?.conversion === null &&
      s.body.totals.views === 3 && s.body.totals.purchases === 1 && s.body.daily.length === 7 &&
      s.body.daily.at(-1).views === 3 && s.body.daily.at(-1).purchases === 1 && s.body.lots[0].id === a,
    JSON.stringify({ totals: s.body.totals, a: row(a), b: row(b), today: s.body.daily?.at(-1) }),
  );

  const one = await j(`/lot-stats?days=30&listingId=${b}`, { token: seller.token });
  const foreign = await j(`/lot-stats?days=30&listingId=${a}`, { token: buyer.token });
  const badDays = await j('/lot-stats?days=5', { token: seller.token });
  const anon = await j('/lot-stats');
  check(
    'График одного лота — его просмотры и покупки; чужой лот — 404; период не 7/30/90 — 400; без входа — 401',
    one.body.daily?.length === 30 && one.body.daily.at(-1).views === 0 && one.body.daily.at(-1).purchases === 1 &&
      foreign.status === 404 && badDays.status === 400 && anon.status === 401,
    JSON.stringify({ one: one.body.daily?.at(-1), foreign: foreign.status, badDays: badDays.status, anon: anon.status }),
  );
}

/**
 * Временная скидка: цена ниже, прежняя — отдельно; заказ — по цене со
 * скидкой; в избранном — уведомление; вторая скидка и правка цены — отказ;
 * «Завершить» и истёкший срок возвращают прежнюю цену.
 */
async function scenarioSale(rnd) {
  console.log('\n— Скидка на лот —');
  const seller = await register('sls', rnd);
  const buyer = await register('slb', rnd);
  const lot = await createListing(seller.token, 'accounts', '150000', { title: `Скидка ${rnd}` });
  await j('/favorites', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  const sale = (body, token = seller.token) =>
    j(`/listings/${lot}/sale`, { method: 'POST', token, body: JSON.stringify(body) });

  const small = await sale({ percent: 3, days: 3 });
  const long = await sale({ percent: 20, days: 30 });
  const foreign = await sale({ percent: 20, days: 3 }, buyer.token);
  const ok = await sale({ percent: 20, days: 3 });
  const again = await sale({ percent: 30, days: 1 });
  const card = (await j(`/listings/${lot}`)).body;
  check(
    'Скидка 20% на 3 суток: цена 1 200 ₽, прежняя 1 500 ₽; 3%, 30 суток, чужой лот и вторая скидка — отказ',
    small.status === 400 && long.status === 400 && foreign.status === 403 && ok.status === 201 &&
      ok.body.price === '120000' && again.status === 400 && card.price === '120000' &&
      card.saleListPrice === '150000' && !!card.saleUntil,
    JSON.stringify({ small: small.status, long: long.status, foreign: foreign.status, ok: ok.body, again: again.status, card: [card.price, card.saleListPrice] }),
  );

  const newPrice = await j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ price: '140000' }) });
  const samePrice = await j(`/listings/${lot}`, {
    method: 'PATCH', token: seller.token, body: JSON.stringify({ price: '120000', title: `Скидка ${rnd} · правка` }),
  });
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  let drop = null;
  for (let i = 0; i < 20 && !drop; i++) {
    await wait(500);
    drop = (await j('/notifications', { token: buyer.token })).body.find((n) => n.type === 'price_drop') ?? null;
  }
  check(
    'Во время скидки: новая цена — отказ, правка без смены цены — да; заказ по 1 200 ₽; в избранном — уведомление',
    newPrice.status === 400 && samePrice.status === 200 && order.body.amount === '120000' &&
      drop?.payload.newPrice === '120000' && drop?.payload.oldPrice === '150000',
    JSON.stringify({ newPrice: newPrice.status, samePrice: samePrice.status, amount: order.body.amount, drop: drop?.payload }),
  );

  const end = await j(`/listings/${lot}/sale`, { method: 'DELETE', token: seller.token });
  const endAgain = await j(`/listings/${lot}/sale`, { method: 'DELETE', token: seller.token });
  const back = (await j(`/listings/${lot}`)).body;
  // Новая скидка, срок которой уже вышел, — цену возвращает фоновая задача.
  // −30%: прошлая скидка (1 200 ₽) была на этой неделе, и честная скидка
  // считается от неё (часть 45) — 1 050 ₽ это −12%, а −10% (1 350 ₽) не скидка.
  const again2 = await sale({ percent: 30, days: 1 });
  if (again2.status !== 201) throw new Error(`Вторая скидка не началась: ${JSON.stringify(again2.body)}`);
  await prisma.listing.update({ where: { id: lot }, data: { saleUntil: new Date(Date.now() - 1000) } });
  let expired = null;
  for (let i = 0; i < 20; i++) {
    await wait(500);
    expired = (await j(`/listings/${lot}`)).body;
    if (expired.price === '150000') break;
  }
  check(
    '«Завершить» и истёкший срок возвращают 1 500 ₽; завершить без скидки — 404',
    end.status === 200 && endAgain.status === 404 && back.price === '150000' && back.saleListPrice === null &&
      expired?.price === '150000' && expired?.saleUntil === null,
    JSON.stringify({ end: end.status, endAgain: endAgain.status, back: [back.price, back.saleListPrice], expired: [expired?.price, expired?.saleUntil] }),
  );
}

/**
 * Промокоды продавца: скидка за его счёт — цена до комиссии ниже; один раз
 * на покупателя, отменённый заказ использование возвращает; предел, «только
 * постоянным», выключенный код — отказ с причиной; «Применить» видит код.
 */
async function scenarioFollowFeed(rnd) {
  console.log('\n— Лента подписок —');
  const [a, b, c, d] = [await register('ffa', rnd), await register('ffb', rnd), await register('ffc', rnd), await register('ffd', rnd)];
  const fan = await register('ffu', rnd);
  const a1 = await createListing(a.token, 'accounts', '100000', { title: `Лента ${rnd} · A1` });
  const a2 = await createListing(a.token, 'accounts', '200000', { title: `Лента ${rnd} · A2` });
  const b1 = await createListing(b.token, 'accounts', '300000', { title: `Лента ${rnd} · B1` });
  const c1 = await createListing(c.token, 'accounts', '400000', { title: `Лента ${rnd} · C1` }); // в чёрном списке
  const d1 = await createListing(d.token, 'accounts', '500000', { title: `Лента ${rnd} · D1` }); // без подписки
  for (const s of [a, b, c]) await j(`/follows/${s.id}`, { method: 'POST', token: fan.token });
  await j('/account/blocks', { method: 'POST', token: fan.token, body: JSON.stringify({ userId: c.id }) });
  await j(`/listings/${a1}/sale`, { method: 'POST', token: a.token, body: JSON.stringify({ percent: 20, days: 3 }) });
  const feed = (tab = 'new') => j(`/follows/feed?tab=${tab}`, { token: fan.token });
  const first = await feed();
  const ids = first.body.items.map((l) => l.id);
  const sale = (await feed('sale')).body;
  check(
    'Лента: лоты продавцов из подписок, новые сверху; без подписки и чёрный список — нет; «со скидкой» — только скидка',
    first.status === 200 && JSON.stringify(ids) === JSON.stringify([b1, a2, a1]) && !ids.includes(c1) &&
      !ids.includes(d1) && first.body.fresh === null && sale.items.length === 1 && sale.items[0].id === a1 &&
      sale.items[0].saleListPrice === '100000',
    JSON.stringify({ ids, expected: [b1, a2, a1], fresh: first.body.fresh, sale: sale.items.map((l) => l.id) }),
  );

  await wait(20); // отметка визита — раньше нового лота
  const b2 = await createListing(b.token, 'accounts', '310000', { title: `Лента ${rnd} · B2` });
  const second = (await feed()).body;
  const third = (await feed()).body;
  const guest = await j('/follows/feed');
  check(
    'С прошлого визита — 1 новый лот, сверху; следующий визит — 0; без входа — 401',
    second.fresh === 1 && second.items[0].id === b2 && third.fresh === 0 && guest.status === 401,
    JSON.stringify({ second: second.fresh, top: second.items[0]?.id, b2, third: third.fresh, guest: guest.status }),
  );
}

async function scenarioBulkPrice(rnd) {
  console.log('\n— Цены разом —');
  const seller = await register('bps', rnd);
  const other = await register('bpo', rnd);
  const buyer = await register('bpb', rnd);
  const a = await createListing(seller.token, 'accounts', '99900', { title: `Цены ${rnd} · A` });
  const b = await createListing(seller.token, 'accounts', '200000', { title: `Цены ${rnd} · B` });
  const foreign = await createListing(other.token, 'accounts', '50000', { title: `Цены ${rnd} · чужой` });
  await j(`/listings/${b}/sale`, { method: 'POST', token: seller.token, body: JSON.stringify({ percent: 20, days: 3 }) });
  await j('/favorites', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: a }) });
  const bulk = (body) => j('/listings/bulk-price', { method: 'POST', token: seller.token, body: JSON.stringify(body) });
  const zero = await bulk({ ids: [a], percent: 0 });
  const huge = await bulk({ ids: [a], percent: 150 });
  const up = await bulk({ ids: [a, b, foreign], percent: 7 });
  const priceOf = async (id) => (await j(`/listings/${id}`)).body.price;
  const reasons = Object.fromEntries((up.body.skipped ?? []).map((x) => [x.id, x.reason]));
  check(
    '+7%: 999 ₽ → 1 069 ₽; лот со скидкой и чужой — пропуск с причиной; 0% и +150% — отказ',
    zero.status === 400 && huge.status === 400 && up.status === 201 && up.body.done === 1 &&
      (await priceOf(a)) === '106900' && (await priceOf(b)) === '160000' && (await priceOf(foreign)) === '50000' &&
      reasons[b] === 'sale' && reasons[foreign] === 'unavailable',
    JSON.stringify({ zero: zero.status, huge: huge.status, up: up.body, a: await priceOf(a) }),
  );

  // −20% — у кого лот в избранном, приходит «подешевел» (часть 35): от 999 ₽,
  // с которыми его добавили, — подорожание точку отсчёта не двигает.
  const down = await bulk({ ids: [a], percent: -20 });
  let drop = null;
  for (let i = 0; i < 20 && !drop; i++) {
    drop = (await j('/notifications', { token: buyer.token })).body.find((n) => n.type === 'price_drop' && n.payload.listingId === a) ?? null;
    if (!drop) await wait(500);
  }
  check(
    '−20%: 1 069 ₽ → 855 ₽, в избранном — уведомление «подешевел»',
    down.body.done === 1 && (await priceOf(a)) === '85500' && drop?.payload.newPrice === '85500',
    JSON.stringify({ down: down.body, a: await priceOf(a), drop: drop?.payload }),
  );
}

async function scenarioPriceHistory(rnd) {
  console.log('\n— История цены —');
  const seller = await register('phs', rnd);
  const lot = await createListing(seller.token, 'accounts', '100000', { title: `История ${rnd}` });
  const as = { token: seller.token };
  // Каждый путь смены цены: правка, цены разом, скидка, её завершение; правка без смены цены — не точка.
  await j(`/listings/${lot}`, { method: 'PATCH', ...as, body: JSON.stringify({ price: '120000' }) });
  await j(`/listings/${lot}`, { method: 'PATCH', ...as, body: JSON.stringify({ title: `История ${rnd} · правка` }) });
  await j('/listings/bulk-price', { method: 'POST', ...as, body: JSON.stringify({ ids: [lot], percent: -10 }) });
  await j(`/listings/${lot}/sale`, { method: 'POST', ...as, body: JSON.stringify({ percent: 20, days: 3 }) });
  await j(`/listings/${lot}/sale`, { method: 'DELETE', ...as });
  const h = await j(`/listings/${lot}/price-history`);
  const prices = h.body.points?.map((p) => p.price);
  check(
    'Правка, цены разом, скидка и её завершение — точки истории; правка без смены цены — нет',
    h.status === 200 && h.body.days === 30 && h.body.topup === false &&
      JSON.stringify(prices) === JSON.stringify(['100000', '120000', '108000', '86400', '108000']),
    JSON.stringify(h.body),
  );

  await j(`/listings/${lot}`, { method: 'PATCH', ...as, body: JSON.stringify({ status: 'paused' }) });
  const paused = await j(`/listings/${lot}/price-history`);
  const bad = await j('/listings/not-a-uuid/price-history');
  check(
    'Снятый лот — 404, неверный адрес — 400',
    paused.status === 404 && bad.status === 400,
    JSON.stringify({ paused: paused.status, bad: bad.status }),
  );
}

async function scenarioHonestSale(rnd) {
  console.log('\n— Честная скидка —');
  const seller = await register('hns', rnd);
  const as = { token: seller.token };
  const sale = (id, percent) =>
    j(`/listings/${id}/sale`, { method: 'POST', ...as, body: JSON.stringify({ percent, days: 3 }) });
  // Держалась 1 000 ₽, подняли до 1 200 ₽ — и сразу «скидка».
  const raised = await createListing(seller.token, 'accounts', '100000', { title: `Честная ${rnd} · поднятая` });
  await j(`/listings/${raised}`, { method: 'PATCH', ...as, body: JSON.stringify({ price: '120000' }) });
  const fake = await sale(raised, 10); // 1 080 ₽ — дороже прежних 1 000
  const thin = await sale(raised, 20); // 960 ₽ — от 1 000 это 4%
  const real = await sale(raised, 30); // 840 ₽ — от 1 000 это 16%
  const card = (await j(`/listings/${raised}`)).body;
  check(
    'Подняли цену и «скидка»: −10% и −20% — отказ с причиной; −30% — скидка от прежних 1 000 ₽, не от 1 200',
    fake.status === 400 && /была 1\s000 ₽ — от неё скидка 0%/.test(fake.body.message) && thin.status === 400 &&
      /скидка 4%/.test(thin.body.message) && real.status === 201 && card.price === '84000' &&
      card.saleRefPrice === '100000' && card.saleListPrice === '120000',
    JSON.stringify({ fake: fake.body?.message, thin: thin.body?.message, real: real.body, card: [card.price, card.saleRefPrice, card.saleListPrice] }),
  );

  // Цена не поднималась — скидка от неё же; по окончании отметка снимается.
  const plain = await createListing(seller.token, 'accounts', '100000', { title: `Честная ${rnd} · обычная` });
  const ok = await sale(plain, 20);
  const during = (await j(`/listings/${plain}`)).body;
  await j(`/listings/${plain}/sale`, { method: 'DELETE', ...as });
  const after = (await j(`/listings/${plain}`)).body;
  check(
    'Цена не поднималась — −20% от неё же; скидку завершили — цена и отметка как были',
    ok.status === 201 && during.saleRefPrice === '100000' && during.price === '80000' &&
      after.price === '100000' && after.saleRefPrice == null && after.saleListPrice == null,
    JSON.stringify({ during: [during.price, during.saleRefPrice], after: [after.price, after.saleRefPrice] }),
  );
}

async function scenarioPriceLow(rnd) {
  console.log('\n— Минимум за 30 дней —');
  const seller = await register('pls', rnd);
  const as = { token: seller.token };
  const lot = await createListing(seller.token, 'accounts', '100000', { title: `Минимум ${rnd}` });
  const setPrice = (price) => j(`/listings/${lot}`, { method: 'PATCH', ...as, body: JSON.stringify({ price }) });
  const low = async () => (await j(`/listings/${lot}`)).body.priceLowUntil ?? null;
  const dropped = async () =>
    (await j(`/listings?sellerId=${seller.id}&drop=1`)).body.items?.map((x) => x.id) ?? [];

  await setPrice('98000'); // −2% — мало для отметки
  const small = await low();
  await setPrice('90000'); // −8% от 980 ₽
  const marked = await low();
  const inFilter = await dropped();
  const first = (await j(`/listings/${lot}`)).body;
  await setPrice('88000'); // снижение следом — меньше 5%, но ниже прежних
  const chained = await low();
  const second = (await j(`/listings/${lot}`)).body;
  const days30 = marked ? new Date(marked).getTime() - Date.now() - 30 * 86_400_000 : NaN;
  check(
    'Снизили на 2% — без отметки; ещё на 8% — «минимум за 30 дней», −8% от 980 ₽, на 30 дней, в фильтре «Цена снижена»; снизили следом — держится, −10% от тех же 980 ₽',
    small === null && Math.abs(days30) < 600_000 && inFilter.includes(lot) && !!chained && chained >= marked &&
      first.priceLowRef === '98000' && first.priceDropPct === 8 &&
      second.priceLowRef === '98000' && second.priceDropPct === 10,
    JSON.stringify({ small, marked, inFilter, chained, first: [first.priceLowRef, first.priceDropPct], second: [second.priceLowRef, second.priceDropPct] }),
  );

  // Сортировка «Сначала большие снижения»: −30% выше −10%, лот без снижения — ниже обоих.
  const big = await createListing(seller.token, 'accounts', '100000', { title: `Минимум ${rnd} · большой` });
  const flat = await createListing(seller.token, 'accounts', '100000', { title: `Минимум ${rnd} · ровный` });
  await j(`/listings/${big}`, { method: 'PATCH', ...as, body: JSON.stringify({ price: '70000' }) });
  const sorted = (await j(`/listings?sellerId=${seller.id}&sort=drop`)).body.items?.map((x) => x.id) ?? [];
  const badSort = await j('/listings?sort=biggest');
  check(
    'Сначала большие снижения: −30%, затем −10%, затем лот без снижения; неизвестная сортировка — 400',
    JSON.stringify(sorted) === JSON.stringify([big, lot, flat]) && badSort.status === 400,
    JSON.stringify({ sorted, expected: [big, lot, flat], badSort: badSort.status }),
  );
  await j(`/listings/${big}`, { method: 'PATCH', ...as, body: JSON.stringify({ status: 'paused' }) });
  await j(`/listings/${flat}`, { method: 'PATCH', ...as, body: JSON.stringify({ status: 'paused' }) });

  await setPrice('100000');
  const raised = await low();
  await setPrice('88000'); // вернули прежнюю: она не ниже самой себя
  const back = await low();
  const outFilter = await dropped();
  check(
    'Подняли — отметка снята; подъём и возврат прежней цены отметки не дают, в фильтре лота нет',
    raised === null && back === null && !outFilter.includes(lot),
    JSON.stringify({ raised, back, outFilter }),
  );

  // Скидка — в фильтре со своей пометкой; её завершение отметку не оставляет.
  const sale = await j(`/listings/${lot}/sale`, { method: 'POST', ...as, body: JSON.stringify({ percent: 20, days: 3 }) });
  const onSale = await dropped();
  const saleCard = (await j(`/listings/${lot}`)).body;
  await j(`/listings/${lot}/sale`, { method: 'DELETE', ...as });
  const ended = (await j(`/listings/${lot}`)).body;
  const afterSale = await dropped();
  check(
    'Скидка — лот в фильтре «Цена снижена», снижение −20% как у скидки; скидку завершили — цена вернулась, отметки и фильтра нет',
    sale.status === 201 && onSale.includes(lot) && saleCard.priceDropPct === 20 && ended.price === '88000' &&
      ended.priceLowUntil == null && ended.priceDropPct == null && !afterSale.includes(lot),
    JSON.stringify({ sale: sale.status, onSale, saleDrop: saleCard.priceDropPct, ended: [ended.price, ended.priceLowUntil, ended.priceDropPct], afterSale }),
  );
}

async function scenarioStockWatch(rnd) {
  console.log('\n— Сообщить о поступлении —');
  const seller = await register('sws', rnd);
  const buyer = await register('swb', rnd);
  const quitter = await register('swq', rnd);
  const lot = await createListing(seller.token, 'accounts', '50000', { title: `Поступление ${rnd}`, stock: 3 });
  const stock = (n) =>
    j(`/listings/${lot}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ stock: n }) });
  const watch = (u, method = 'POST') => j(`/stock-watches/${lot}`, { method, token: u.token });
  const inStock = await watch(buyer);
  await stock(0);
  const soldOut = (await j(`/listings/${lot}`)).body.status;
  const own = await watch(seller);
  const first = await watch(buyer);
  const again = await watch(buyer);
  const status = await j(`/stock-watches/${lot}`, { token: buyer.token });
  await watch(quitter);
  const left = await watch(quitter, 'DELETE');
  const guest = await j(`/stock-watches/${lot}`, { method: 'POST' });
  check(
    'Лот в продаже и свой — ждать нельзя; закончился — «Сообщить о поступлении», повтор не двоит; передумал — снято; без входа — 401',
    inStock.status === 400 && soldOut === 'sold_out' && own.status === 400 && first.status === 201 &&
      first.body.watching === true && again.body.watching === true && status.body.watching === true &&
      left.body.watching === false && guest.status === 401,
    JSON.stringify({ inStock: inStock.status, soldOut, own: own.status, first: first.body, again: again.body, status: status.body, left: left.body, guest: guest.status }),
  );

  await stock(5);
  const notes = async (u) =>
    (await j('/notifications', { token: u.token })).body.filter((n) => n.type === 'back_in_stock');
  let got = [];
  for (let i = 0; i < 20 && !got.length; i++) {
    await wait(500);
    got = await notes(buyer);
  }
  const after = await j(`/stock-watches/${lot}`, { token: buyer.token });
  const quiet = await notes(quitter);
  await stock(0);
  await stock(4);
  await wait(3000);
  const once = await notes(buyer);
  check(
    'Пополнили наличие — одно уведомление «снова в продаже» со ссылкой на лот, ожидание снято; передумавшему — ничего; следующее пополнение — без повтора',
    got.length === 1 && got[0].payload?.listingId === lot && /снова в продаже/.test(got[0].payload?.preview ?? '') &&
      after.body.watching === false && quiet.length === 0 && once.length === 1,
    JSON.stringify({ got: got.map((n) => n.payload), after: after.body, quiet: quiet.length, once: once.length }),
  );
}

async function scenarioRecentCards(rnd) {
  console.log('\n— Вы недавно смотрели —');
  const seller = await register('rcs', rnd);
  const as = { token: seller.token };
  const a = await createListing(seller.token, 'accounts', '10000', { title: `Смотрели ${rnd} · А`, stock: 2 });
  const b = await createListing(seller.token, 'accounts', '20000', { title: `Смотрели ${rnd} · Б` });
  const gone = await createListing(seller.token, 'accounts', '30000', { title: `Смотрели ${rnd} · снят` });
  await j(`/listings/${a}`, { method: 'PATCH', ...as, body: JSON.stringify({ stock: 0 }) });
  await j(`/listings/${gone}`, { method: 'PATCH', ...as, body: JSON.stringify({ status: 'paused' }) });
  const unknown = '00000000-0000-4000-8000-000000000000';
  const got = await j(`/listings/cards?ids=${[b, gone, a, unknown, b].join(',')}`);
  const ids = Array.isArray(got.body) ? got.body.map((x) => x.id) : got.body;
  const bad = await j('/listings/cards?ids=not-a-uuid');
  const many = await j(`/listings/cards?ids=${Array.from({ length: 25 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`).join(',')}`);
  check(
    'Карточки по id — в том же порядке, закончившийся с «закончился», снятый и неизвестный пропадают, повтор — один раз; неверный id и больше 24 — 400',
    got.status === 200 && JSON.stringify(ids) === JSON.stringify([b, a]) && got.body[1]?.status === 'sold_out' &&
      bad.status === 400 && many.status === 400,
    JSON.stringify({ status: got.status, ids, expected: [b, a], bad: bad.status, many: many.status }),
  );
}

async function scenarioPriceStats(rnd) {
  console.log('\n— Подсказка цены —');
  const seller = await register('pss', rnd);
  const as = { token: seller.token };
  const game = await j('/catalog/games/cs2');
  const other = game.body.categories.find((c) => c.slug === 'other');
  const service = game.body.categories.find((c) => c.slug === 'service');
  const stats = async (cat, q = '') => (await j(`/listings/price-stats?categoryId=${cat.id}${q}`)).body;
  const coaching = encodeURIComponent(JSON.stringify({ kind: 'Обучение' }));
  // «Прочее» в CS2 пустое: тест снимает свои лоты в конце.
  const before = await stats(other);
  const ids = [];
  for (const rub of [100, 200, 300, 400, 500]) {
    ids.push(await createListing(seller.token, 'other', String(rub * 100), { title: `Цены ${rnd} · ${rub}` }));
  }
  const all = await stats(other);
  const mine = await stats(other, `&except=${ids[0]}`);
  const packed = await stats(other, '&pack=10');
  const fallback = await stats(other, `&attrs=${coaching}`);
  check(
    'Подсказка цены: пустой раздел — без цен; 5 лотов 100…500 ₽ — от 100, чаще всего 200–400, медиана 300; свой лот не в счёт; пачка ×10; параметров нет — по разделу',
    before.count === 0 && before.min === undefined && all.scope === 'category' && all.count === 5 &&
      all.min === '10000' && all.p25 === '20000' && all.median === '30000' && all.p75 === '40000' &&
      mine.count === 4 && mine.min === '20000' && packed.min === '100000' &&
      fallback.scope === 'category' && fallback.count === 5,
    JSON.stringify({ before, all, mine, packed, fallback }),
  );

  const svc = [];
  for (const rub of [1000, 2000, 3000]) {
    svc.push(
      await createListing(seller.token, 'service', String(rub * 100), {
        title: `Обучение ${rnd} · ${rub}`,
        attributes: { kind: 'Обучение' },
      }),
    );
  }
  const same = await stats(service, `&attrs=${coaching}`);
  const bad = await j('/listings/price-stats?categoryId=nope');
  check(
    'С теми же параметрами («Обучение» в услугах) — подсказка по ним; неверный раздел — 400',
    same.scope === 'attrs' && same.count >= 3 && bad.status === 400,
    JSON.stringify({ same, bad: bad.status }),
  );
  for (const id of [...ids, ...svc]) {
    await j(`/listings/${id}`, { method: 'PATCH', ...as, body: JSON.stringify({ status: 'paused' }) });
  }
}

async function scenarioImport(rnd) {
  console.log('\n— Загрузка из таблицы —');
  const seller = await register('ims', rnd);
  const game = await j('/catalog/games/cs2');
  const accounts = game.body.categories.find((c) => c.slug === 'accounts');
  const keys = game.body.categories.find((c) => c.slug === 'keys');
  const lot = (line, over = {}) => ({
    line, title: `Импорт ${rnd} · ${line}`, description: 'Из таблицы', price: '50000', stock: null,
    attributes: { ...REQUIRED_ATTRS.accounts }, ...over,
  });
  const send = (categoryId, lots, opts = {}) =>
    j('/listings/import', {
      method: 'POST', token: seller.token, ...opts,
      body: JSON.stringify({ gameId: game.body.id, categoryId, lots }),
    });
  const res = await send(accounts.id, [
    lot(2),
    lot(3, { stock: 2 }),
    lot(4, { attributes: { region: 'EU' } }),
    lot(5, { attributes: { ...REQUIRED_ATTRS.accounts, rank: 'Нет такого' } }),
    lot(6, { price: '0' }),
  ]);
  const mine = (await j('/listings/mine', { token: seller.token })).body.filter((l) => l.title.startsWith(`Импорт ${rnd}`));
  const third = mine.find((l) => l.title.endsWith('· 3'));
  check(
    'Из таблицы: годные строки выставлены (с наличием), у негодных — номер строки и причина',
    res.status === 201 && JSON.stringify(res.body.created.map((c) => c.line)) === '[2,3]' &&
      JSON.stringify(res.body.failed) === JSON.stringify([
        { line: 4, message: 'Укажите характеристику «Звание»' },
        { line: 5, message: 'Недопустимое значение «Звание»' },
        { line: 6, message: 'Цена — число больше нуля, например 490' },
      ]) && mine.length === 2 && third?.stock === 2 && mine.every((l) => l.status === 'active'),
    JSON.stringify({ status: res.status, body: res.body, mine: mine.map((l) => [l.title, l.stock, l.status]) }),
  );

  const en = await send(accounts.id, [lot(7, { price: '0' })], { headers: { 'Accept-Language': 'en' } });
  const wrong = await send(keys.id, [lot(2)]);
  const guest = await j('/listings/import', { method: 'POST', body: JSON.stringify({ gameId: game.body.id, categoryId: accounts.id, lots: [lot(2)] }) });
  const tooMany = await send(accounts.id, Array.from({ length: 201 }, (_, i) => lot(i + 2)));
  check(
    'Причина по-английски на английском сайте; ключи из таблицы — 400; без входа — 401; больше 200 строк — 400',
    en.body.failed?.[0]?.message === 'The price must be a number above zero, for example 490' && en.body.created.length === 0 &&
      wrong.status === 400 && guest.status === 401 && tooMany.status === 400,
    JSON.stringify({ en: en.body, wrong: [wrong.status, wrong.body?.message], guest: guest.status, tooMany: tooMany.status }),
  );
}

async function scenarioExportEdit(rnd) {
  console.log('\n— Выгрузка своих лотов и правка таблицей —');
  const seller = await register('exs', rnd);
  const other = await register('exo', rnd);
  const as = { token: seller.token };
  const game = await j('/catalog/games/cs2');
  const accounts = game.body.categories.find((c) => c.slug === 'accounts');
  const a = await createListing(seller.token, 'accounts', '50000', { title: `Выгрузка ${rnd} · А`, description: 'Описание А' });
  const b = await createListing(seller.token, 'accounts', '60000', { title: `Выгрузка ${rnd} · Б`, stock: 2 });
  const onSale = await createListing(seller.token, 'accounts', '70000', { title: `Выгрузка ${rnd} · скидка` });
  const auto = await createListing(seller.token, 'accounts', '80000', { title: `Выгрузка ${rnd} · авто`, autoDelivery: true });
  const skin = await createListing(seller.token, 'skins', '9000', { title: `Выгрузка ${rnd} · скин` });
  const foreign = await createListing(other.token, 'accounts', '50000', { title: `Выгрузка ${rnd} · чужой` });
  await j(`/listings/${onSale}/sale`, { method: 'POST', ...as, body: JSON.stringify({ percent: 20, days: 3 }) });
  const exp = await j(`/listings/export?categoryId=${accounts.id}`, as);
  const ids = Array.isArray(exp.body) ? exp.body.map((l) => l.id) : [];
  const rowA = exp.body.find?.((l) => l.id === a);
  check(
    'Выгрузка: свои лоты раздела целиком с описанием и наличием; с автовыдачей, другого раздела и чужие — нет; без входа — 401',
    exp.status === 200 && ids.includes(a) && ids.includes(b) && ids.includes(onSale) && !ids.includes(auto) &&
      !ids.includes(skin) && !ids.includes(foreign) && rowA?.description === 'Описание А' && rowA?.price === '50000' &&
      exp.body.find((l) => l.id === b)?.stock === 2 &&
      (await j(`/listings/export?categoryId=${accounts.id}`)).status === 401,
    JSON.stringify({ status: exp.status, ids: ids.length, rowA }),
  );

  const attrs = { ...REQUIRED_ATTRS.accounts };
  const row = (line, over) => ({ line, title: '', description: '', price: '', stock: null, attributes: {}, ...over });
  const res = await j('/listings/import', {
    method: 'POST', ...as,
    body: JSON.stringify({
      gameId: game.body.id,
      categoryId: accounts.id,
      lots: [
        row(2, { id: a, title: `Выгрузка ${rnd} · А, новое название`, price: '45000' }),
        row(3, { id: b, title: `Выгрузка ${rnd} · Б`, description: 'test', price: '60000', stock: 2, attributes: attrs }),
        row(4, { id: foreign, title: `Выгрузка ${rnd} · чужой`, price: '1000' }),
        row(5, { id: skin, title: `Выгрузка ${rnd} · скин`, price: '1000' }),
        row(6, { id: onSale, title: `Выгрузка ${rnd} · скидка`, price: '10000' }),
        row(7, { title: `Выгрузка ${rnd} · новый`, description: 'Новый из таблицы', price: '30000', attributes: attrs }),
      ],
    }),
  });
  const after = (await j(`/listings/${a}`)).body;
  check(
    'Таблица с ID: лот изменён (пустое описание — оставлено), без изменений — не тронут, чужой — «не найден», другой раздел и скидка — с причиной, строка без ID — новый лот',
    res.status === 201 && JSON.stringify(res.body.updated?.map((x) => x.line)) === '[2]' &&
      JSON.stringify(res.body.unchanged?.map((x) => x.line)) === '[3]' &&
      JSON.stringify(res.body.created?.map((x) => x.line)) === '[7]' &&
      JSON.stringify(res.body.failed) === JSON.stringify([
        { line: 4, message: 'Лот не найден' },
        { line: 5, message: 'Этот лот — из другого раздела' },
        { line: 6, message: 'Идёт скидка — завершите её, потом меняйте цену' },
      ]) &&
      after.title === `Выгрузка ${rnd} · А, новое название` && after.price === '45000' && after.description === 'Описание А',
    JSON.stringify({ status: res.status, body: res.body, after: [after.title, after.price, after.description] }),
  );
}

async function scenarioBuyerReview(rnd) {
  console.log('\n— Оценка покупателя продавцом —');
  const seller = await register('brs', rnd);
  const seller2 = await register('brt', rnd);
  const buyer = await register('brb', rnd);
  const deal = async (s) => {
    const listingId = await createListing(s.token, 'accounts', '20000', { title: `Оценка ${rnd}` });
    const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId }) });
    await pay(buyer.token, order.body.id);
    return order.body.id;
  };
  const rate = (u, orderId, body) =>
    j(`/orders/${orderId}/buyer-review`, { method: 'PUT', token: u.token, body: JSON.stringify(body) });
  const o1 = await deal(seller);
  const early = await rate(seller, o1, { good: true });
  const before = (await j(`/orders/${o1}/buyer-review`, { token: seller.token })).body;
  await j(`/orders/${o1}/deliver`, { method: 'POST', token: seller.token });
  await j(`/orders/${o1}/confirm`, { method: 'POST', token: buyer.token });
  const byBuyer = await rate(buyer, o1, { good: true });
  const first = await rate(seller, o1, { good: true, comment: 'Быстро подтвердил' });
  const edited = await rate(seller, o1, { good: true, comment: 'Быстро подтвердил, спасибо' });
  const notes = (await j('/notifications', { token: buyer.token })).body.filter((n) => n.type === 'buyer_review');
  const asBuyer = (await j(`/orders/${o1}/buyer-review`, { token: buyer.token })).body;
  const stranger = await j(`/orders/${o1}/buyer-review`, { token: seller2.token });
  check(
    'Оценка покупателя: до завершения — 400, покупатель сам себе — 403; продавец — «рекомендую» с комментарием, уведомление одно; покупатель видит оценку без статистики; чужой — 403',
    early.status === 400 && before.canRate === false && before.stats?.deals === 0 && byBuyer.status === 403 &&
      first.status === 200 && edited.body.comment === 'Быстро подтвердил, спасибо' && notes.length === 1 &&
      /рекомендует вас как покупателя/.test(notes[0].payload?.preview ?? '') &&
      asBuyer.review?.good === true && asBuyer.review?.comment === 'Быстро подтвердил, спасибо' && asBuyer.stats === null &&
      stranger.status === 403,
    JSON.stringify({ early: early.status, before, byBuyer: byBuyer.status, first: first.status, notes: notes.length, asBuyer, stranger: stranger.status }),
  );

  // Второй продавец: видит прошлую сделку покупателя и чужую оценку, ставит свою.
  const o2 = await deal(seller2);
  const seen = (await j(`/orders/${o2}/buyer-review`, { token: seller2.token })).body;
  await j(`/orders/${o2}/deliver`, { method: 'POST', token: seller2.token });
  await j(`/orders/${o2}/confirm`, { method: 'POST', token: buyer.token });
  const bad = await rate(seller2, o2, { good: false });
  const profile = (await j(`/sellers/${buyer.id}`)).body;
  const removed = await j(`/orders/${o2}/buyer-review`, { method: 'DELETE', token: seller2.token });
  const profileAfter = (await j(`/sellers/${buyer.id}`)).body;
  check(
    'Другой продавец видит покупки и оценки покупателя; в профиле — «как покупатель» числами; оценку можно убрать',
    seen.stats?.deals === 1 && seen.stats?.good === 1 && seen.stats?.bad === 0 && seen.canRate === false &&
      bad.status === 200 && profile.asBuyer?.deals === 2 && profile.asBuyer?.good === 1 && profile.asBuyer?.bad === 1 &&
      removed.status === 200 && profileAfter.asBuyer?.bad === 0,
    JSON.stringify({ seen, bad: bad.status, asBuyer: profile.asBuyer, after: profileAfter.asBuyer }),
  );
}

async function scenarioSellerToday(rnd) {
  console.log('\n— Сводка «Сегодня» —');
  const seller = await register('tds', rnd);
  const buyer = await register('tdb', rnd);
  const fresh = (await j('/sellers/me/today', { token: seller.token })).body;
  const lot = await createListing(seller.token, 'accounts', '20000', { title: `Сегодня ${rnd}` });
  const empty = await createListing(seller.token, 'accounts', '30000', { title: `Сегодня ${rnd} · кончился`, stock: 1 });
  await j(`/listings/${empty}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ stock: 0 }) });
  const order = await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) });
  await pay(buyer.token, order.body.id);
  const chat = await j(`/conversations/for-listing/${empty}`, { method: 'POST', token: buyer.token });
  await j(`/conversations/${chat.body.id}/messages`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Будет ещё?' }) });
  const today = (await j('/sellers/me/today', { token: seller.token })).body;
  const guest = await j('/sellers/me/today');
  check(
    'Сегодня: новичку без лотов — не нужна; продажа, заработанное, выдать, закончившийся лот и непрочитанное — числами; без входа — 401',
    fresh.seller === false && today.seller === true && today.sales?.count === 1 &&
      today.sales.earned === order.body.sellerPayoutAmount && today.waiting?.toDeliver === 1 &&
      today.waiting.soldOut === 1 && today.waiting.unreadMessages >= 1 && today.waiting.disputes === 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(today.day) && guest.status === 401,
    JSON.stringify({ fresh: fresh.seller, today, guest: guest.status }),
  );
}

async function scenarioLoginAlert(rnd) {
  console.log('\n— Вход с нового устройства —');
  const user = await register('lgn', rnd);
  const email = `lgn${rnd}@e2e.local`;
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const login = (ua) =>
    j('/auth/login', {
      method: 'POST',
      headers: ua ? { 'User-Agent': ua } : {},
      body: JSON.stringify({ email, password: 'password123' }),
    });
  const alerts = async () =>
    (await j('/notifications', { token: user.token })).body.filter((n) => n.type === 'new_login');
  await wait(500);
  const afterRegister = await alerts();
  const same = await login();
  await wait(500);
  const afterSame = await alerts();
  const other = await login(FIREFOX);
  let got = [];
  for (let i = 0; i < 10 && !got.length; i++) {
    await wait(300);
    got = await alerts();
  }
  const twice = await login(FIREFOX);
  await wait(500);
  const again = await alerts();
  check(
    'Вход: регистрация и тот же браузер — молчат; новый (Firefox) — «Вход с нового устройства» с устройством; повторный вход с него — не новость',
    afterRegister.length === 0 && same.status === 200 && afterSame.length === 0 && other.status === 200 &&
      got.length === 1 && got[0].payload?.device === 'Firefox · Windows' && /Вход с нового устройства/.test(got[0].payload?.preview ?? '') &&
      again.length === 1,
    JSON.stringify({ afterRegister: afterRegister.length, same: same.status, afterSame: afterSame.length, other: other.status, got: got.map((n) => n.payload), again: again.length }),
  );

  // «Это не я»: уведомление ведёт к сеансу; завершаются оба входа с Firefox,
  // свои сеансы живут, а следующий вход с Firefox снова даёт предупреждение.
  const session = got[0]?.payload?.session;
  const mine = (await j('/auth/sessions', { token: user.token })).body;
  const current = mine.find((s) => s.current)?.id;
  const self = await j(`/auth/sessions/${current}/not-me`, { method: 'POST', token: user.token });
  const stranger = await register('lgx', rnd);
  const foreign = await j(`/auth/sessions/${session}/not-me`, { method: 'POST', token: stranger.token });
  const before = (await j('/notifications', { token: twice.body.accessToken })).status;
  const denied = await j(`/auth/sessions/${session}/not-me`, { method: 'POST', token: user.token });
  const firstFf = (await j('/notifications', { token: other.body.accessToken })).status;
  const secondFf = (await j('/notifications', { token: twice.body.accessToken })).status;
  const own = (await j('/notifications', { token: same.body.accessToken })).status;
  await login(FIREFOX);
  let back = [];
  for (let i = 0; i < 10 && back.length < 2; i++) {
    await wait(300);
    back = await alerts();
  }
  check(
    '«Это не я»: сеанс из уведомления в списке; свой текущий и чужой — отказ; оба входа с Firefox завершены, свой остался; новый вход с Firefox — снова предупреждение',
    typeof session === 'string' && mine.some((s) => s.id === session) && self.status === 400 && foreign.status === 404 &&
      before === 200 && denied.status === 200 && denied.body.closedSessions === 2 && firstFf === 401 && secondFf === 401 &&
      own === 200 && back.length === 2 && back[0].payload?.session !== session,
    JSON.stringify({ session, listed: mine.length, self: self.status, foreign: foreign.status, before, denied: denied.body, firstFf, secondFf, own, back: back.length }),
  );
}

// Пароль изменён: уведомление с устройством и IP, ссылки «Это не я» в данных
// нет (она только в письме); ссылка сброса без отпечатка пароля не действует.
async function scenarioPasswordChanged(rnd) {
  console.log('\n— Пароль изменён —');
  const user = await register('pwc', rnd);
  const email = `pwc${rnd}@e2e.local`;
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const changed = await j('/auth/password', {
    method: 'POST', token: user.token, headers: { 'User-Agent': CHROME },
    body: JSON.stringify({ current: 'password123', next: 'password456' }),
  });
  let got = [];
  for (let i = 0; i < 10 && !got.length; i++) {
    await wait(300);
    got = (await j('/notifications', { token: user.token })).body.filter((n) => n.type === 'password_changed');
  }
  const login = (password) => j('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  const oldPass = await login('password123');
  const newPass = await login('password456');
  const payload = got[0]?.payload ?? {};
  check(
    'Пароль изменён: уведомление «Chrome · Windows» с IP, ссылки сброса в данных нет; старый пароль не входит, новый — входит',
    changed.status === 200 && got.length === 1 && payload.device === 'Chrome · Windows' &&
      /^Пароль изменён: Chrome · Windows, IP /.test(payload.preview ?? '') && !/token|reset/.test(JSON.stringify(payload)) &&
      oldPass.status === 401 && newPass.status === 200,
    JSON.stringify({ changed: changed.status, got: got.map((n) => n.payload), old: oldPass.status, new: newPass.status }),
  );
  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret) {
    const hs256 = (p) => {
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const t = Math.floor(Date.now() / 1000);
      const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ ...p, iat: t, exp: t + 600 })}`;
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    };
    const reset = (token) => j('/auth/reset', { method: 'POST', body: JSON.stringify({ token, password: 'password789' }) });
    const bare = await reset(hs256({ sub: user.id, purpose: 'pwd_reset' }));
    const stale = await reset(hs256({ sub: user.id, purpose: 'pwd_reset', bind: '0123456789abcdef' }));
    const still = await login('password456');
    check(
      'Ссылка сброса без отпечатка пароля или со старым — 400, пароль прежний',
      bare.status === 400 && stale.status === 400 && still.status === 200,
      `${bare.status}/${stale.status}/${still.status}`,
    );
  }
}

// Вход с кодом включён и выключен: уведомления с устройством, ссылки «Это не я»
// в данных нет; выключить по ссылке без верного отпечатка ключа нельзя.
async function scenarioTwoFactorAlert(rnd) {
  console.log('\n— Вход с кодом включён —');
  const user = await register('tfn', rnd);
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const ua = { 'User-Agent': CHROME };
  const setup = await j('/auth/2fa/setup', { method: 'POST', token: user.token });
  const on = await j('/auth/2fa/enable', { method: 'POST', token: user.token, headers: ua, body: JSON.stringify({ code: authenticator.generate(setup.body.secret) }) });
  const alerts = async (type) => (await j('/notifications', { token: user.token })).body.filter((n) => n.type === type);
  let enabled = [];
  for (let i = 0; i < 10 && !enabled.length; i++) {
    await wait(300);
    enabled = await alerts('two_factor_enabled');
  }
  const off = await j('/auth/2fa/disable', { method: 'POST', token: user.token, headers: ua, body: JSON.stringify({ code: authenticator.generate(setup.body.secret) }) });
  let disabled = [];
  for (let i = 0; i < 10 && !disabled.length; i++) {
    await wait(300);
    disabled = await alerts('two_factor_disabled');
  }
  check(
    'Вход с кодом: включение и выключение — уведомления «Chrome · Windows», ссылки «Это не я» в данных нет',
    on.status === 201 && off.status === 201 && enabled.length === 1 && disabled.length === 1 &&
      enabled[0].payload?.device === 'Chrome · Windows' && /^Вход с кодом из приложения включён: /.test(enabled[0].payload?.preview ?? '') &&
      !/token|recover/.test(JSON.stringify(enabled[0].payload)),
    JSON.stringify({ on: on.status, off: off.status, enabled: enabled.map((n) => n.payload), disabled: disabled.length }),
  );
  const secret = process.env.JWT_ACCESS_SECRET;
  if (secret) {
    const hs256 = (p) => {
      const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
      const t = Math.floor(Date.now() / 1000);
      const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ ...p, iat: t, exp: t + 600 })}`;
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
    };
    const again = await j('/auth/2fa/setup', { method: 'POST', token: user.token });
    await j('/auth/2fa/enable', { method: 'POST', token: user.token, body: JSON.stringify({ code: authenticator.generate(again.body.secret) }) });
    const revoke = (token) => j('/auth/2fa/revoke', { method: 'POST', body: JSON.stringify({ token, password: 'password123', next: 'password789' }) });
    const bare = await revoke(hs256({ sub: user.id, purpose: 'tf_revoke' }));
    const stale = await revoke(hs256({ sub: user.id, purpose: 'tf_revoke', bind: '0123456789abcdef' }));
    const status = (await j('/auth/2fa', { token: user.token })).body;
    check(
      '«Это не я» для входа с кодом: ссылка без отпечатка ключа или с чужим — 400, защита на месте',
      bare.status === 400 && stale.status === 400 && status.enabled === true,
      `${bare.status}/${stale.status}/${status.enabled}`,
    );
  }
}

// «Не могу войти»: ответ один для любой почты, владельцу — уведомление и
// «Заявку подал не я», сотруднику — совпадения заказов; раньше 3 дней —
// нельзя, потом — вход с кодом, сеансы и пароль сброшены.
async function scenarioRecovery(rnd) {
  console.log('\n— Не могу войти —');
  const seller = await register('qrs', rnd);
  const owner = await register('qro', rnd);
  const agent = await register('qra', rnd);
  await grant(agent.id, 'agent');
  const lot = await createListing(seller.token, 'accounts', '15000', { title: `Восстановление ${rnd}` });
  const order = await j('/orders', { method: 'POST', token: owner.token, body: JSON.stringify({ listingId: lot }) });
  // «Чужой» включил вход с кодом на аккаунте владельца.
  const setup = await j('/auth/2fa/setup', { method: 'POST', token: owner.token });
  await j('/auth/2fa/enable', { method: 'POST', token: owner.token, body: JSON.stringify({ code: authenticator.generate(setup.body.secret) }) });
  const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
  const ask = (email) =>
    j('/recovery', {
      method: 'POST', headers: { 'User-Agent': CHROME },
      body: JSON.stringify({ email, reason: 'two_factor', orderNumbers: [order.body.publicNumber.toLowerCase(), 'GM-NOPE-0000'], details: 'Чужой включил вход с кодом, не могу войти' }),
    });
  const none = await ask(`nobody${rnd}@e2e.local`);
  const first = await ask(`QRO${rnd}@e2e.local`);
  const again = await ask(`qro${rnd}@e2e.local`);
  let alerts = [];
  for (let i = 0; i < 10 && !alerts.length; i++) {
    await wait(300);
    alerts = (await j('/notifications', { token: owner.token })).body.filter((n) => n.type === 'recovery_requested');
  }
  const mine = (await j('/recovery/mine', { token: owner.token })).body.request;
  const queue = (await j('/recovery/queue', { token: agent.token })).body;
  const row = queue.find((r) => r.id === mine?.id);
  const outsider = await j('/recovery/queue', { token: seller.token });
  const objected = await j(`/recovery/${mine?.id}/object`, { method: 'POST', token: owner.token });
  const detail = (await j(`/recovery/${mine?.id}`, { token: agent.token })).body;
  const early = await j(`/recovery/${mine?.id}/restore`, { method: 'POST', token: agent.token });
  check(
    '«Не могу войти»: ответ один для любой почты; заявка одна; владельцу — уведомление; сотруднику — 1 из 2 заказов, возражение владельца, вход с кодом; раньше 3 дней — 400; чужому — 403',
    [none, first, again].every((r) => r.status === 201 && JSON.stringify(r.body) === '{"ok":true}') &&
      alerts.length === 1 && /^Подана заявка на восстановление доступа к аккаунту: Chrome · Windows/.test(alerts[0].payload?.preview ?? '') &&
      row?.orders?.given === 2 && row.orders.found === 1 && outsider.status === 403 && objected.status === 200 &&
      detail.objected?.from?.startsWith('Браузер') && detail.orders?.[0]?.found === true && detail.orders[0].role === 'buyer' &&
      detail.orders[1]?.found === false && !!detail.account?.twoFactorSince &&
      detail.history?.some((h) => h.type === 'two_factor_enabled') && early.status === 400,
    JSON.stringify({ none: none.status, first: first.status, alerts: alerts.length, row: row?.orders, outsider: outsider.status, objected: objected.status, detail: { objected: detail.objected, orders: detail.orders }, early: early.status }),
  );
  await prisma.accountRecovery.update({ where: { id: mine.id }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });
  const restored = await j(`/recovery/${mine.id}/restore`, { method: 'POST', token: agent.token });
  const oldSession = (await j('/notifications', { token: owner.token })).status;
  const oldPassword = (await j('/auth/login', { method: 'POST', body: JSON.stringify({ email: `qro${rnd}@e2e.local`, password: 'password123' }) })).status;
  const tf = await prisma.twoFactor.findUnique({ where: { userId: owner.id } });
  const user = await prisma.user.findUnique({ where: { id: owner.id }, select: { passwordHash: true } });
  const twice = await j(`/recovery/${mine.id}/restore`, { method: 'POST', token: agent.token });
  const logged = await prisma.auditLog.count({ where: { action: 'recovery.restore', entityId: owner.id, actorId: agent.id } });
  check(
    'Через 3 дня сотрудник восстанавливает: вход с кодом выключен, сеансы и пароль сброшены, в журнале; второй раз — 400',
    restored.status === 200 && oldSession === 401 && oldPassword === 401 && tf === null && user?.passwordHash === null &&
      twice.status === 400 && logged === 1,
    JSON.stringify({ restored: restored.status, oldSession, oldPassword, tf: !!tf, hash: user?.passwordHash === null, twice: twice.status, logged }),
  );
}

// Нет доступа и к почте: новая почта в заявке; документы просят только при
// пройденной проверке личности; по ссылке — свои файлы и один раз; через 3
// дня — доступ на новую почту, в журнале — прежняя и новая почта.
async function scenarioRecoveryNewEmail(rnd) {
  console.log('\n— Не могу войти: нет доступа к почте —');
  const owner = await register('qno', rnd);
  const other = await register('qnx', rnd);
  const agent = await register('qna', rnd);
  await grant(agent.id, 'agent');
  await prisma.kycVerification.create({
    data: { userId: owner.id, level: 'document', status: 'approved', reviewedAt: new Date(), documentRefs: { keys: [`kyc/${owner.id}/doc.png`], selfie: `kyc/${owner.id}/me.png` } },
  });
  const fresh = `qnnew${rnd}@e2e.local`;
  const ask = (email) =>
    j('/recovery', { method: 'POST', body: JSON.stringify({ email, reason: 'password', orderNumbers: [], details: 'Нет доступа ни к аккаунту, ни к почте', newEmail: fresh.toUpperCase() }) });
  const sent = await ask(`qno${rnd}@e2e.local`);
  await ask(`qnx${rnd}@e2e.local`);
  const queue = (await j('/recovery/queue', { token: agent.token })).body;
  const mine = queue.find((r) => r.email === `qno${rnd}@e2e.local`);
  const theirs = queue.find((r) => r.email === `qnx${rnd}@e2e.local`);
  const noKyc = await j(`/recovery/${theirs?.id}/request-docs`, { method: 'POST', token: agent.token });
  const asked = await j(`/recovery/${mine?.id}/request-docs`, { method: 'POST', token: agent.token });
  const rec = await prisma.accountRecovery.findUnique({ where: { id: mine.id } });
  const secret = process.env.JWT_ACCESS_SECRET;
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ data: { rid: mine.id, at: rec.evidenceRequestedAt.getTime() }, purpose: 'recovery_docs', iat: t, exp: t + 600 })}`;
  const token = `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
  const status = await j('/recovery/docs/status', { method: 'POST', body: JSON.stringify({ token }) });
  const forged = await j('/recovery/docs/status', { method: 'POST', body: JSON.stringify({ token: token.slice(0, -4) + 'AAAA' }) });
  const abs = (u) => new URL(u, API).toString();
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
  const upload = async () => {
    const up = await j('/recovery/docs/uploads', { method: 'POST', body: JSON.stringify({ token, mime: 'image/png' }) });
    const put = await fetch(abs(up.body.uploadUrl), { method: 'PUT', body: png, headers: { 'Content-Type': 'image/png' } });
    return put.ok ? up.body.key : null;
  };
  const [doc, selfie] = [await upload(), await upload()];
  const foreign = await j('/recovery/docs', { method: 'POST', body: JSON.stringify({ token, documentKeys: [`kyc/${owner.id}/doc.png`], selfieKey: selfie }) });
  const submitted = await j('/recovery/docs', { method: 'POST', body: JSON.stringify({ token, documentKeys: [doc], selfieKey: selfie }) });
  const again = await j('/recovery/docs', { method: 'POST', body: JSON.stringify({ token, documentKeys: [doc], selfieKey: selfie }) });
  const detail = (await j(`/recovery/${mine.id}`, { token: agent.token })).body;
  const early = await j(`/recovery/${mine.id}/restore-new-email`, { method: 'POST', token: agent.token });
  check(
    'Нет доступа к почте: новая почта в заявке; без проверки личности документы не просят; по ссылке — свои файлы и один раз; сотруднику — одобренные и присланные документы; раньше 3 дней — 400',
    sent.status === 201 && mine?.newEmail === fresh && noKyc.status === 400 && asked.status === 200 &&
      status.status === 200 && status.body.submitted === false && forged.status === 400 &&
      !!doc && !!selfie && foreign.status === 400 && submitted.status === 201 && again.status === 409 &&
      detail.contact?.email === fresh && detail.contact.taken === false && detail.kyc?.files?.length === 2 &&
      detail.evidence?.files?.length === 2 && early.status === 400,
    JSON.stringify({ sent: sent.status, newEmail: mine?.newEmail, noKyc: noKyc.status, asked: asked.status, status: status.body, forged: forged.status, foreign: foreign.status, submitted: submitted.status, again: again.status, contact: detail.contact, kyc: detail.kyc?.files?.length, evidence: detail.evidence?.files?.length, early: early.status }),
  );
  await prisma.accountRecovery.update({ where: { id: mine.id }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });
  const restored = await j(`/recovery/${mine.id}/restore-new-email`, { method: 'POST', token: agent.token });
  const user = await prisma.user.findUnique({ where: { id: owner.id }, select: { email: true, emailVerified: true, passwordHash: true } });
  const log = await prisma.auditLog.findFirst({ where: { action: 'recovery.restore_new_email', entityId: owner.id } });
  const oldSession = (await j('/notifications', { token: owner.token })).status;
  check(
    'Через 3 дня — доступ на новую почту: почта сменена и подтверждена, пароль сброшен, сеанс закрыт, в журнале — прежняя и новая почта',
    restored.status === 200 && user?.email === fresh && !!user.emailVerified && user.passwordHash === null && oldSession === 401 &&
      log?.before?.email === `qno${rnd}@e2e.local` && log?.after?.email === fresh,
    JSON.stringify({ restored: restored.status, email: user?.email, verified: !!user?.emailVerified, oldSession, log: { before: log?.before, after: log?.after } }),
  );
}

// Нет проверки личности: сделки описывают по ссылке на новую почту, другая
// сторона отвечает у себя в кабинете; ответ с IP заявителя не считается;
// через 3 дня при двух подтверждениях — доступ на новую почту.
async function scenarioRecoveryDeals(rnd) {
  console.log('\n— Не могу войти: по сделкам —');
  const owner = await register('qwo', rnd);
  const sellers = [await register('qw1', rnd), await register('qw2', rnd), await register('qw3', rnd)];
  const agent = await register('qwa', rnd);
  await grant(agent.id, 'agent');
  // Завершённые до заявки покупки владельца у каждого из продавцов.
  for (const [i, s] of sellers.entries()) {
    const lot = await createListing(s.token, 'accounts', '20000', { title: `По сделкам ${rnd} · ${i + 1}` });
    const order = await j('/orders', { method: 'POST', token: owner.token, body: JSON.stringify({ listingId: lot }) });
    await prisma.order.update({ where: { id: order.body.id }, data: { status: 'completed', completedAt: new Date(Date.now() - 86_400_000) } });
  }
  const CLAIM_IP = '203.0.113.71';
  const fresh = `qwnew${rnd}@e2e.local`;
  const sent = await j('/recovery', {
    method: 'POST', headers: { 'X-Forwarded-For': CLAIM_IP },
    body: JSON.stringify({ email: `qwo${rnd}@e2e.local`, reason: 'password', orderNumbers: [], details: 'Нет доступа ни к аккаунту, ни к почте', newEmail: fresh }),
  });
  const mine = (await j('/recovery/queue', { token: agent.token })).body.find((r) => r.email === `qwo${rnd}@e2e.local`);
  const docs = await j(`/recovery/${mine?.id}/request-docs`, { method: 'POST', token: agent.token });
  const asked = await j(`/recovery/${mine?.id}/request-deals`, { method: 'POST', token: agent.token });
  const rec = await prisma.accountRecovery.findUnique({ where: { id: mine.id } });
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const t = Math.floor(Date.now() / 1000);
  const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ data: { rid: mine.id, at: rec.dealsRequestedAt.getTime() }, purpose: 'recovery_deals', iat: t, exp: t + 600 })}`;
  const token = `${body}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(body).digest('base64url')}`;
  const status = await j('/recovery/deals/status', { method: 'POST', body: JSON.stringify({ token }) });
  const asDocs = await j('/recovery/docs/status', { method: 'POST', body: JSON.stringify({ token }) });
  const text = (n) => `Сделка ${n}: аккаунт CS2, договорились в чате о передаче вечером`;
  const submit = (deals) =>
    j('/recovery/deals', { method: 'POST', headers: { 'X-Forwarded-For': CLAIM_IP }, body: JSON.stringify({ token, deals }) });
  const short = await submit([{ counterparty: `qw1${rnd}`, text: 'коротко' }, { counterparty: `qw2${rnd}`, text: text(2) }]);
  const all = [{ counterparty: `@QW1${rnd}`, text: text(1) }, { counterparty: `qw2${rnd}`, text: text(2) }, { counterparty: `qw3${rnd}`, text: text(3) }];
  const submitted = await submit(all);
  const again = await submit(all);
  let alerts = [];
  for (let i = 0; i < 10 && !alerts.length; i++) {
    await wait(300);
    alerts = (await j('/notifications', { token: sellers[0].token })).body.filter((n) => n.type === 'deal_check');
  }
  const checks = async (u) => (await j('/recovery/checks', { token: u.token })).body;
  const [c1] = await checks(sellers[0]);
  const ownerChecks = await checks(owner);
  const answer = (u, id, value, ip) =>
    j(`/recovery/checks/${id}`, { method: 'POST', token: u.token, headers: { 'X-Forwarded-For': ip }, body: JSON.stringify({ answer: value }) });
  const foreign = await answer(sellers[1], c1?.id, 'match', '198.51.100.72');
  // С того же IP, что заявка, — похоже, отвечает сам заявитель.
  const first = await answer(sellers[0], c1?.id, 'match', CLAIM_IP);
  const twice = await answer(sellers[0], c1?.id, 'mismatch', '198.51.100.71');
  check(
    'По сделкам: документы без проверки личности не просят; ссылка «Опишите сделки» — своя; описания — один раз; другой стороне — уведомление и просьба с её сделкой; ответ — только свой и один раз',
    sent.status === 201 && docs.status === 400 && asked.status === 200 && status.status === 200 && status.body.submitted === false &&
      asDocs.status === 400 && short.status === 400 && submitted.status === 201 && again.status === 409 &&
      alerts.length === 1 && alerts[0].payload?.username === `qwo${rnd}` && c1?.text === text(1) && c1.deals?.length === 1 &&
      c1.deals[0].youSold === true && ownerChecks.length === 0 && foreign.status === 404 && first.status === 200 && twice.status === 409,
    JSON.stringify({ sent: sent.status, docs: docs.status, asked: asked.status, status: status.body, asDocs: asDocs.status, short: short.status, submitted: submitted.status, again: again.status, alerts: alerts.map((n) => n.payload), c1, owner: ownerChecks.length, foreign: foreign.status, first: first.status, twice: twice.status }),
  );
  const [c2] = await checks(sellers[1]);
  const [c3] = await checks(sellers[2]);
  await answer(sellers[1], c2?.id, 'match', '198.51.100.72');
  const one = (await j(`/recovery/${mine.id}`, { token: agent.token })).body;
  const early = await j(`/recovery/${mine.id}/restore-new-email`, { method: 'POST', token: agent.token });
  await answer(sellers[2], c3?.id, 'match', '198.51.100.73');
  const two = (await j(`/recovery/${mine.id}`, { token: agent.token })).body;
  check(
    'Сотруднику — описания и ответы: с IP заявителя не считается; одно подтверждение — нельзя, два — можно, но не раньше 3 дней',
    one.deals?.confirmed === 1 && /двух разных/.test(one.contact?.blocker ?? '') && early.status === 400 &&
      two.deals?.confirmed === 2 && two.contact?.blocker === null && two.deals.items.length === 3 &&
      two.deals.items.filter((it) => it.sameIp).length === 1 && two.deals.items.every((it) => it.party?.together === 1 && it.answer === 'match'),
    JSON.stringify({ one: { deals: one.deals?.confirmed, blocker: one.contact?.blocker }, early: early.status, two: { confirmed: two.deals?.confirmed, blocker: two.contact?.blocker, items: two.deals?.items } }),
  );
  await prisma.accountRecovery.update({ where: { id: mine.id }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });
  const restored = await j(`/recovery/${mine.id}/restore-new-email`, { method: 'POST', token: agent.token });
  const user = await prisma.user.findUnique({ where: { id: owner.id }, select: { email: true, emailVerified: true, passwordHash: true } });
  const log = await prisma.auditLog.findFirst({ where: { action: 'recovery.restore_new_email', entityId: owner.id } });
  check(
    'Через 3 дня по двум подтверждениям — доступ на новую почту, в журнале — «по сделкам»',
    restored.status === 200 && user?.email === fresh && !!user.emailVerified && user.passwordHash === null &&
      log?.after?.proof === 'deals' && log.before?.email === `qwo${rnd}@e2e.local`,
    JSON.stringify({ restored: restored.status, email: user?.email, log: { before: log?.before, after: log?.after } }),
  );
}

// Смена почты: с паролем, сменится по ссылке с новой почты; прежняя почта
// 7 дней занята за аккаунтом; «Это не я» с неё — почта прежняя, пароль
// новый, все устройства вышли.
async function scenarioEmailChange(rnd) {
  console.log('\n— Смена почты —');
  const user = await register('emc', rnd);
  await register('emx', rnd);
  const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0';
  const ask = (body) => j('/auth/email', { method: 'POST', token: user.token, headers: { 'User-Agent': FIREFOX }, body: JSON.stringify(body) });
  const wrong = await ask({ email: `emcnew${rnd}@e2e.local`, password: 'nope-nope' });
  const taken = await ask({ email: `EMX${rnd}@e2e.local`, password: 'password123' });
  const asked = await ask({ email: `EmcNew${rnd}@e2e.local`, password: 'password123' });
  const change = await prisma.emailChange.findFirst({ where: { userId: user.id, status: 'pending' } });
  const sign = (data, purpose) => {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const t = Math.floor(Date.now() / 1000);
    const body = `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ data, purpose, iat: t, exp: t + 600 })}`;
    return `${body}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(body).digest('base64url')}`;
  };
  const before = (await prisma.user.findUnique({ where: { id: user.id }, select: { email: true } })).email;
  const asRevert = await j('/auth/email/revert/status', { method: 'POST', body: JSON.stringify({ token: sign({ cid: change?.id }, 'email_change') }) });
  const confirmed = await j('/auth/email/confirm', { method: 'POST', body: JSON.stringify({ token: sign({ cid: change?.id }, 'email_change') }) });
  const twice = await j('/auth/email/confirm', { method: 'POST', body: JSON.stringify({ token: sign({ cid: change?.id }, 'email_change') }) });
  const login = (email, password) => j('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  const byNew = await login(`emcnew${rnd}@e2e.local`, 'password123');
  const byOld = await login(`emc${rnd}@e2e.local`, 'password123');
  const squat = await j('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: `emc${rnd}@e2e.local`, password: 'password123', username: `emq${rnd}` }),
  });
  let alerts = [];
  for (let i = 0; i < 10 && !alerts.length; i++) {
    await wait(300);
    alerts = (await j('/notifications', { token: user.token })).body.filter((n) => n.type === 'email_changed');
  }
  check(
    'Смена почты: неверный пароль — 400, занятая — 409; без ссылки почта прежняя; ссылкой — сменена, повтор — 400; вход по новой; прежнюю 7 дней не занять; уведомление «Firefox · Windows»',
    wrong.status === 400 && taken.status === 409 && asked.status === 200 && before === `emc${rnd}@e2e.local` &&
      change?.newEmail === `emcnew${rnd}@e2e.local` && asRevert.status === 400 && confirmed.status === 200 &&
      confirmed.body.email === `emcnew${rnd}@e2e.local` && twice.status === 400 && byNew.status === 200 && byOld.status === 401 &&
      squat.status === 409 && alerts.length === 1 && /Firefox · Windows/.test(alerts[0].payload?.preview ?? '') &&
      !/token|revert/.test(JSON.stringify(alerts[0].payload)),
    JSON.stringify({ wrong: wrong.status, taken: taken.status, asked: asked.status, before, confirmed: confirmed.body, twice: twice.status, byNew: byNew.status, byOld: byOld.status, squat: squat.status, alerts: alerts.map((n) => n.payload) }),
  );
  const revertToken = sign({ cid: change.id }, 'email_revert');
  const status = await j('/auth/email/revert/status', { method: 'POST', body: JSON.stringify({ token: revertToken }) });
  const short = await j('/auth/email/revert', { method: 'POST', body: JSON.stringify({ token: revertToken, password: 'short' }) });
  const reverted = await j('/auth/email/revert', { method: 'POST', body: JSON.stringify({ token: revertToken, password: 'password789' }) });
  const again = await j('/auth/email/revert', { method: 'POST', body: JSON.stringify({ token: revertToken, password: 'password789' }) });
  const oldSession = (await j('/notifications', { token: byNew.body.accessToken })).status;
  const back = await login(`emc${rnd}@e2e.local`, 'password789');
  const stale = await login(`emc${rnd}@e2e.local`, 'password123');
  const log = await prisma.auditLog.findFirst({ where: { action: 'email.revert', entityId: user.id } });
  check(
    '«Это не я» со старой почты: почта прежняя, пароль новый, все устройства вышли; второй раз — 400',
    status.status === 200 && status.body.email === 'e***@e2e.local' && short.status === 400 && reverted.status === 200 &&
      again.status === 400 && oldSession === 401 && back.status === 200 && stale.status === 401 &&
      log?.after?.email === `emc${rnd}@e2e.local`,
    JSON.stringify({ status: status.body, short: short.status, reverted: reverted.body, again: again.status, oldSession, back: back.status, stale: stale.status }),
  );
}

async function scenarioQtyDiscount(rnd) {
  console.log('\n— Скидка за количество —');
  const seller = await register('qds', rnd);
  const buyer = await register('qdb', rnd);
  const game = await j('/catalog/games/cs2');
  const cat = game.body.categories.find((c) => c.slug === 'skins');
  const tryLot = (extra) =>
    j('/listings', {
      method: 'POST', token: seller.token,
      body: JSON.stringify({
        gameId: game.body.id, categoryId: cat.id, title: `Скидка за количество ${rnd}`, description: 'test',
        price: '10000', currency: 'RUB', attributes: REQUIRED_ATTRS.skins ?? {},
        unitName: 'шт.', pricePerUnits: 1, minQty: 2, stock: 100, ...extra,
      }),
    });
  const tiers = [{ from: 50, pct: 10 }, { from: 10, pct: 5 }];
  const whole = await tryLot({ unitName: null, stock: null, qtyDiscounts: tiers });
  const atMin = await tryLot({ qtyDiscounts: [{ from: 2, pct: 5 }] });
  const down = await tryLot({ qtyDiscounts: [{ from: 10, pct: 10 }, { from: 50, pct: 5 }] });
  const big = await tryLot({ qtyDiscounts: [{ from: 10, pct: 60 }] });
  const ok = await tryLot({ qtyDiscounts: tiers });
  const lotId = ok.body.id;
  const card = (await j(`/listings/${lotId}`)).body;
  check(
    'Ступени у целого лота, от минимума, убывающие и 60% — отказ; у поштучного — сохранены по возрастанию',
    whole.status === 400 && atMin.status === 400 && down.status === 400 && big.status === 400 && ok.status === 201 &&
      JSON.stringify(card.qtyDiscounts?.map((t) => [t.from, t.pct])) === '[[10,5],[50,10]]',
    JSON.stringify({ whole: whole.status, atMin: atMin.body?.message, down: down.body?.message, big: big.body?.message, card: card.qtyDiscounts }),
  );

  const order = (qty) =>
    j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lotId, qty }) });
  const [o5, o20, o60] = [await order(5), await order(20), await order(60)];
  check(
    'Заказ: 5 шт. — 500 ₽; 20 шт. — 1 900 ₽ (−5%); 60 шт. — 5 400 ₽ (−10%), ступень в заказе',
    o5.body.amount === '50000' && !o5.body.listingSnapshot?.qtyDiscount && o20.body.amount === '190000' &&
      o20.body.listingSnapshot?.qtyDiscount?.pct === 5 && o20.body.listingSnapshot.qtyDiscount.discount === '10000' &&
      o60.body.amount === '540000' && o60.body.listingSnapshot?.qtyDiscount?.pct === 10,
    JSON.stringify([o5.body.amount, o20.body.amount, o20.body.listingSnapshot?.qtyDiscount, o60.body.amount]),
  );

  const patch = (body) =>
    j(`/listings/${lotId}`, { method: 'PATCH', token: seller.token, body: JSON.stringify(body) });
  const minUp = await patch({ minQty: 20 });
  const cleared = await patch({ qtyDiscounts: [] });
  const after = (await j(`/listings/${lotId}`)).body;
  const o20b = await order(20);
  check(
    'Минимум выше ступени — отказ; ступени сняты — 20 шт. снова 2 000 ₽',
    minUp.status === 400 && cleared.status === 200 && after.qtyDiscounts == null && o20b.body.amount === '200000',
    JSON.stringify({ minUp: minUp.body?.message, cleared: cleared.status, after: after.qtyDiscounts, o20b: o20b.body.amount }),
  );
}

async function scenarioFollow(rnd) {
  console.log('\n— Подписка на продавца —');
  const seller = await register('fws', rnd);
  const fan = await register('fwa', rnd);
  const quiet = await register('fwb', rnd); // уведомления по подписке выключены
  const blocked = await register('fwc', rnd); // в чёрном списке продавца
  const old = await createListing(seller.token, 'accounts', '100000', { title: `Подписка ${rnd} · старый` });
  const follow = (u, method = 'POST', body) =>
    j(`/follows/${seller.id}`, { method, token: u.token, ...(body ? { body: JSON.stringify(body) } : {}) });
  const self = await follow(seller);
  const first = await follow(fan);
  const again = await follow(fan);
  await follow(quiet);
  await follow(quiet, 'PATCH', { notify: false });
  await follow(blocked);
  await j('/account/blocks', { method: 'POST', token: seller.token, body: JSON.stringify({ userId: blocked.id }) });
  const profile = (await j(`/sellers/${seller.id}`)).body;
  const status = (await follow(fan, 'GET')).body;
  check(
    'Подписка: на себя — 400; повтор не двоит; в профиле — 3 подписчика; кнопка видит подписку',
    self.status === 400 && first.status === 201 && again.status === 201 && again.body.followers === 1 &&
      profile.followers === 3 && status.following === true && status.notify === true,
    JSON.stringify({ self: self.status, first: first.body, again: again.body, followers: profile.followers, status }),
  );

  const notes = async (u, type) =>
    (await j('/notifications', { token: u.token })).body.filter((n) => n.type === type);
  const waitNotes = async (u, type, n) => {
    for (let i = 0; i < 20; i++) {
      const list = await notes(u, type);
      if (list.length >= n) return list;
      await wait(500);
    }
    return notes(u, type);
  };
  const fresh = await createListing(seller.token, 'accounts', '120000', { title: `Подписка ${rnd} · новый` });
  const got = await waitNotes(fan, 'seller_new_lots', 1);
  await wait(2500); // ещё один-два прохода — повтора нет
  const still = await notes(fan, 'seller_new_lots');
  const others = [...(await notes(quiet, 'seller_new_lots')), ...(await notes(blocked, 'seller_new_lots'))];
  check(
    'Новый лот — одно уведомление со ссылкой на лот; старый лот, выключенные уведомления и чёрный список — нет',
    got.length === 1 && still.length === 1 && still[0].payload.listingId === fresh &&
      still[0].payload.sellerId === seller.id && others.length === 0 && !JSON.stringify(still).includes(old),
    JSON.stringify({ still: still.map((n) => n.payload), others: others.length }),
  );

  await j(`/listings/${old}/sale`, { method: 'POST', token: seller.token, body: JSON.stringify({ percent: 20, days: 3 }) });
  const sale = await waitNotes(fan, 'seller_sale', 1);
  check(
    'Скидка на старый лот — уведомление «800 ₽ вместо 1 000 ₽» со ссылкой на лот',
    sale.length === 1 && sale[0].payload.listingId === old &&
      /800 ₽ вместо 1 000 ₽/.test(String(sale[0].payload.preview).replace(/\s/g, ' ')),
    JSON.stringify(sale.map((n) => n.payload)),
  );

  const list = (await j('/follows', { token: fan.token })).body;
  const off = await follow(fan, 'DELETE');
  await createListing(seller.token, 'accounts', '130000', { title: `Подписка ${rnd} · после отписки` });
  await wait(3000);
  const after = await notes(fan, 'seller_new_lots');
  check(
    '«Мои подписки»: продавец, 2 лота, 1 со скидкой; после отписки новое не приходит, подписчиков — 2',
    list.length === 1 && list[0].sellerId === seller.id && list[0].activeListings === 2 && list[0].onSale === 1 &&
      off.status === 200 && off.body.followers === 2 && after.length === 1,
    JSON.stringify({ list, off: off.body, after: after.length }),
  );
}

async function scenarioSellerPromo(rnd) {
  console.log('\n— Промокоды продавца —');
  const seller = await register('kds', rnd);
  const b1 = await register('kda', rnd);
  const b2 = await register('kdb', rnd);
  const b3 = await register('kdc', rnd);
  const lot = await createListing(seller.token, 'accounts', '100000', { title: `Промокод ${rnd}` });
  const code = `SAVE${String(rnd).slice(-6)}`;
  const mk = (body) => j('/seller-promos', { method: 'POST', token: seller.token, body: JSON.stringify(body) });
  const p1 = await mk({ code: code.toLowerCase(), percent: 10, maxUses: 2, days: 30 });
  const p2 = await mk({ code: `LOYAL${String(rnd).slice(-6)}`, percent: 20, repeatOnly: true });
  const dup = await mk({ code, percent: 15 });
  const short = await mk({ code: 'AB', percent: 10 });
  const big = await mk({ code: 'BIGSALE1', percent: 70 });
  check(
    'Код в верхнем регистре; повтор, короткий код и скидка больше 50% — отказ',
    p1.status === 201 && p1.body.code === code && p2.status === 201 && dup.status === 400 &&
      short.status === 400 && big.status === 400,
    JSON.stringify({ p1: p1.body?.code, dup: dup.status, short: short.status, big: big.status }),
  );

  const preview = await j(`/promo/check?code=${code.toLowerCase()}&listingId=${lot}`, { token: b1.token });
  const plain = await j('/orders', { method: 'POST', token: b3.token, body: JSON.stringify({ listingId: lot }) });
  const order = (token, promoCode) =>
    j('/orders', { method: 'POST', token, body: JSON.stringify({ listingId: lot, promoCode }) });
  const o1 = await order(b1.token, code);
  const again = await order(b1.token, code);
  check(
    '«Применить» видит код продавца; заказ 900 ₽ вместо 1 000, выплата продавцу — от 900; второй раз — отказ',
    preview.body.source === 'seller' && preview.body.percent === 10 && o1.status === 201 &&
      o1.body.amount === '90000' && BigInt(o1.body.sellerPayoutAmount) < BigInt(plain.body.sellerPayoutAmount) &&
      o1.body.listingSnapshot?.sellerPromo?.discount === '10000' && again.status === 400,
    JSON.stringify({ preview: preview.body, o1: [o1.body.amount, o1.body.sellerPayoutAmount], plain: plain.body.sellerPayoutAmount, again: again.body?.message }),
  );

  // Отменённый заказ использование возвращает.
  await j(`/orders/${o1.body.id}/cancel`, { method: 'POST', token: b1.token });
  const reuse = await order(b1.token, code);
  const o2 = await order(b2.token, code);
  const over = await order(b3.token, code);
  const loyal = await order(b2.token, `LOYAL${String(rnd).slice(-6)}`);
  check(
    'После отмены код снова доступен; предел 2 — третьему отказ; «только постоянным» без сделок — отказ',
    reuse.status === 201 && o2.status === 201 && over.status === 400 && /закончился/.test(over.body.message) &&
      loyal.status === 400 && /уже покупал у этого/.test(loyal.body.message),
    JSON.stringify({ reuse: reuse.status, o2: o2.status, over: over.body?.message, loyal: loyal.body?.message }),
  );

  await j(`/seller-promos/${p1.body.id}`, { method: 'PATCH', token: seller.token, body: JSON.stringify({ active: false }) });
  const off = await j(`/promo/check?code=${code}&listingId=${lot}`, { token: b3.token });
  const unknown = await j(`/promo/check?code=NOPE${rnd}&listingId=${lot}`);
  const listed = (await j('/seller-promos', { token: seller.token })).body;
  check(
    'Выключенный код — отказ с причиной, неизвестный — 404; в списке продавца — 2 использования',
    off.status === 400 && /выключил/.test(off.body.message) && unknown.status === 404 &&
      listed.find((p) => p.code === code)?.used === 2,
    JSON.stringify({ off: off.body?.message, unknown: unknown.status, used: listed.find((p) => p.code === code)?.used }),
  );
}

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
      top.body.redirect === true && pt.confirmation.return_url.endsWith('/cabinet/wallet?topup=1') && wallet.body.balance === '50000',
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

    // ── «Не могу войти» по карте: 1 ₽ блокируется и снимается ──
    const cardRow = await prisma.payment.findUnique({ where: { providerRef: dep.body.providerRef } });
    check(
      'Карта оплаты сохранена без номера: первые 6 и последние 4 цифры',
      cardRow?.card?.first6 === '555555' && cardRow.card.last4 === '4477' && !JSON.stringify(cardRow.card).includes('5555555555554477'),
      JSON.stringify(cardRow?.card),
    );
    // Картой платили месяц назад: свежая карта не засчитывается.
    await prisma.payment.update({ where: { id: cardRow.id }, data: { createdAt: new Date(Date.now() - 30 * 86_400_000) } });
    const ag = await reg('yka');
    await grant(ag.id, 'agent');
    const claim = (who, ip) =>
      k('/recovery', {
        method: 'POST', headers: { 'X-Forwarded-For': ip },
        body: JSON.stringify({ email: `${who}${rnd}@e2e.local`, reason: 'password', orderNumbers: [], details: 'Нет доступа ни к аккаунту, ни к почте', newEmail: `${who}new${rnd}@e2e.local` }),
      });
    await claim('ykb', '203.0.113.81');
    await claim('ykf', '203.0.113.82');
    const queue = (await k('/recovery/queue', { token: ag.token })).body;
    const rid = queue.find((r) => r.email === `ykb${rnd}@e2e.local`)?.id;
    const noCards = await k(`/recovery/${queue.find((r) => r.email === `ykf${rnd}@e2e.local`)?.id}/request-card`, { method: 'POST', token: ag.token });
    const askedCard = await k(`/recovery/${rid}/request-card`, { method: 'POST', token: ag.token });
    const recCard = await prisma.accountRecovery.findUnique({ where: { id: rid } });
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const jwtBody = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ data: { rid, at: recCard.cardRequestedAt.getTime() }, purpose: 'recovery_card', iat: now, exp: now + 600 })}`;
    const cardToken = `${jwtBody}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(jwtBody).digest('base64url')}`;
    const cardCall = (path) => k(`/recovery/card/${path}`, { method: 'POST', body: JSON.stringify({ token: cardToken }) });
    const open = await cardCall('status');
    const pay1 = await cardCall('pay');
    const pay1again = await cardCall('pay');
    const hold1 = [...yk.payments.values()].find((p) => p.confirmation.confirmation_url === pay1.body.url);
    // Банк отклонил: попытка не засчитывается, можно ещё раз.
    await fetch(`${pay1.body.url}?result=canceled`, { redirect: 'manual' });
    const declined = await cardCall('status');
    const pay2 = await cardCall('pay');
    const hold2 = [...yk.payments.values()].find((p) => p.confirmation.confirmation_url === pay2.body.url);
    const returned = await fetch(`${pay2.body.url}?card=5555555555554477`, { redirect: 'manual' });
    const done = await cardCall('status');
    for (let i = 0; i < 10 && hold2?.status !== 'canceled'; i++) await wait(200);
    const asOrder = await prisma.payment.count({ where: { externalId: { in: [hold1?.id, hold2?.id] } } });
    check(
      'По карте: без карт в аккаунте — 400; 1 ₽ блокируется без списания, одна блокировка на попытку; отклонённая — не в счёт; оплатил — карта сверена, блокировка снята, заказом не стала',
      noCards.status === 400 && askedCard.status === 200 && open.body.state === 'open' &&
        hold1?.capture === false && hold1.amount.value === '1.00' && hold1.metadata.purpose === 'recovery_card' &&
        pay1again.body.url === pay1.body.url && declined.body.state === 'open' && declined.body.failed === true &&
        hold2 && hold2.id !== hold1.id && returned.status === 302 && returned.headers.get('location').includes('/recover/card?token=') &&
        done.body.state === 'done' && hold2.status === 'canceled' && hold2.cancelled_by_shop === true && asOrder === 0,
      JSON.stringify({ noCards: noCards.body?.message, asked: askedCard.status, open: open.body, hold1: hold1 && { capture: hold1.capture, amount: hold1.amount, status: hold1.status }, declined: declined.body, done: done.body, hold2: hold2?.status, asOrder }),
    );
    const cardDetail = (await k(`/recovery/${rid}`, { token: ag.token })).body;
    const earlyCard = await k(`/recovery/${rid}/restore-new-email`, { method: 'POST', token: ag.token });
    await prisma.accountRecovery.update({ where: { id: rid }, data: { createdAt: new Date(Date.now() - 73 * 3_600_000) } });
    const byCard = await k(`/recovery/${rid}/restore-new-email`, { method: 'POST', token: ag.token });
    const moved = await prisma.user.findUnique({ where: { id: buyer.id }, select: { email: true } });
    const cardLog = await prisma.auditLog.findFirst({ where: { action: 'recovery.restore_new_email', entityId: buyer.id } });
    check(
      'Сотруднику — карта совпала с оплатой; через 3 дня по карте — доступ на новую почту, в журнале «по карте»',
      cardDetail.card?.result?.matched === true && cardDetail.card.result.source === 'payment' && cardDetail.card.result.last4 === '4477' &&
        cardDetail.contact?.blocker === null && earlyCard.status === 400 && byCard.status === 200 &&
        moved?.email === `ykbnew${rnd}@e2e.local` && cardLog?.after?.proof === 'card',
      JSON.stringify({ card: cardDetail.card, blocker: cardDetail.contact?.blocker, early: earlyCard.status, byCard: byCard.status, email: moved?.email, proof: cardLog?.after?.proof }),
    );
  } finally {
    child.kill();
    yk.close();
  }
}

/**
 * Кнопки и ответы в Telegram. Бот включается ключами при запуске, а основной
 * API работает без него, — поэтому здесь поднимается второй API (порт 4101) с
 * ботом против тестового сервера Bot API (telegram-mock.mjs).
 */
async function scenarioTelegramBot(rnd) {
  console.log('\n— Кнопки в Telegram —');
  const base = 'http://localhost:4101';
  const TOKEN = '123456:e2e-bot-token';
  const tg = await startTelegramMock(4996, TOKEN);
  const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/main.js', import.meta.url))], {
    env: {
      ...process.env,
      API_PORT: '4101',
      API_URL: base,
      TELEGRAM_BOT_TOKEN: TOKEN,
      TELEGRAM_BOT_USERNAME: 'gm_e2e_bot',
      TELEGRAM_WEBHOOK_SECRET: 'e2e-hook-secret',
      TELEGRAM_API_URL: 'http://localhost:4996',
      WEB_URL: 'http://localhost:3000',
      ORDER_SWEEP_INTERVAL_MS: '3600000',
      SKIP_DOTENV: '1',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const k = (path, opts = {}) => j(path, { ...opts, base });
  const hook = (update) =>
    k('/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'e2e-hook-secret' }, body: JSON.stringify(update) });
  const waitFor = async (fn) => {
    for (let i = 0; i < 20; i++) {
      const v = await fn();
      if (v) return v;
      await wait(200);
    }
    return null;
  };
  // Тестовый Bot API видит сообщение раньше, чем API запомнит его диалог: отвечать — после этого.
  const mapped = (chat, messageId) =>
    waitFor(() => prisma.telegramReply.findUnique({ where: { chatId_messageId: { chatId: String(chat), messageId: messageId ?? 0 } } }));
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      up = (await k('/health').catch(() => ({ status: 0 }))).status === 200;
      if (!up) await wait(500);
    }
    check('Второй API с ботом запущен', up, up ? '' : stderr.slice(-400));
    if (!up) return;
    const reg = async (p) => {
      const r = await k('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: `${p}${rnd}@e2e.local`, password: 'password123', username: `${p}${rnd}` }),
      });
      return { token: r.body.accessToken, id: r.body.user?.id };
    };
    const buyer = await reg('tgb');
    const seller = await reg('tgs');
    const BUYER_CHAT = 700000 + (rnd % 100000);
    const SELLER_CHAT = BUYER_CHAT + 1;
    const link = async (u, chat) => {
      const url = (await k('/account/telegram/link', { method: 'POST', token: u.token })).body.url;
      return hook({ message: { text: `/start ${new URL(url).searchParams.get('start')}`, chat: { id: chat, type: 'private' }, from: { id: chat } } });
    };
    await link(buyer, BUYER_CHAT);
    await link(seller, SELLER_CHAT);
    // Сделка: лот, заказ, оплата заглушкой; выдачу продавец отмечает из бота.
    const game = await k('/catalog/games/cs2');
    const cat = game.body.categories.find((c) => c.slug === 'accounts');
    const lot = await k('/listings', {
      method: 'POST', token: seller.token,
      body: JSON.stringify({ gameId: game.body.id, categoryId: cat.id, title: `Кнопки в Telegram ${rnd}`, description: 'test', price: '50000', currency: 'RUB', attributes: REQUIRED_ATTRS.accounts ?? {} }),
    });
    const order = (await k('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot.body.id }) })).body;
    const dep = await k('/payments/deposit', { method: 'POST', token: buyer.token, body: JSON.stringify({ orderId: order.id }) });
    await k('/payments/mock/callback?providerRef=' + dep.body.providerRef, { method: 'POST' });
    const press = (chat, data, messageId) =>
      hook({ callback_query: { id: `q${Math.random()}`, from: { id: chat }, message: { message_id: messageId, chat: { id: chat, type: 'private' } }, data } });
    const status = async () => (await k(`/orders/${order.id}`, { token: buyer.token })).body.status;
    const paidNote = await waitFor(() =>
      tg.to(SELLER_CHAT).find((c) => c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `dv:${order.id}`),
    );
    await press(SELLER_CHAT, `dv:${order.id}`, paidNote?.result?.message_id);
    const dvAsk = await waitFor(() => tg.to(SELLER_CHAT).find((c) => /^Отметить выдачу по заказу/.test(c.body.text ?? '')));
    const dvYes = dvAsk?.body.reply_markup?.inline_keyboard?.[0]?.[0];
    const afterDvAsk = await status();
    // Покупатель нажимает «Да» по выдаче — это кнопка не для него.
    await press(BUYER_CHAT, `dy:${order.id}`, 6);
    const dvForeign = await waitFor(() => tg.to(BUYER_CHAT).find((c) => c.method === 'editMessageText' && c.body.text === 'Это не ваш заказ'));
    const afterDvForeign = await status();
    await press(SELLER_CHAT, dvYes?.callback_data, dvAsk?.result?.message_id);
    const dvDone = await waitFor(() =>
      tg.to(SELLER_CHAT).find((c) => c.method === 'editMessageText' && /^Выдача отмечена: заказ/.test(c.body.text ?? '')),
    );
    check(
      'Telegram: «Отметить выдачу» под «Заказ оплачен» — с переспросом; у покупателя кнопка не действует; «Да, товар передан» — заказ выдан',
      !!paidNote && !!dvAsk && dvYes?.callback_data === `dy:${order.id}` && afterDvAsk === 'paid' && !!dvForeign &&
        afterDvForeign === 'paid' && dvDone?.body.message_id === dvAsk?.result?.message_id && (await status()) === 'delivered',
      JSON.stringify({ paidNote: paidNote?.body.text, dvAsk: dvAsk?.body.text, afterDvAsk, dvForeign: !!dvForeign, afterDvForeign, dvDone: dvDone?.body }),
    );
    const delivered = await waitFor(() =>
      tg.to(BUYER_CHAT).find((c) => c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `cf:${order.id}`),
    );
    await press(BUYER_CHAT, `cf:${order.id}`, delivered?.result?.message_id);
    const question = await waitFor(() => tg.to(BUYER_CHAT).find((c) => /^Подтвердить получение по заказу/.test(c.body.text ?? '')));
    const yes = question?.body.reply_markup?.inline_keyboard?.[0]?.[0];
    const afterAsk = await status();
    // Чужой Telegram нажимает «Да» по заказу покупателя.
    await press(SELLER_CHAT, `cy:${order.id}`, 5);
    const foreign = await waitFor(() => tg.to(SELLER_CHAT).find((c) => c.method === 'editMessageText' && c.body.text === 'Это не ваш заказ'));
    const afterForeign = await status();
    const questionId = question?.result?.message_id;
    await press(BUYER_CHAT, yes?.callback_data, questionId);
    const confirmed = await waitFor(() =>
      tg.to(BUYER_CHAT).find((c) => c.method === 'editMessageText' && /^Получение подтверждено/.test(c.body.text ?? '')),
    );
    await press(BUYER_CHAT, `cy:${order.id}`, questionId);
    const again = await waitFor(() => tg.to(BUYER_CHAT).find((c) => /уже не ждёт подтверждения/.test(c.body.text ?? '')));
    const releases = (await prisma.ledgerEntry.groupBy({ by: ['txnId'], where: { orderId: order.id, refType: 'order_release' } })).length;
    check(
      'Telegram: «Подтвердить получение» под «Товар выдан» — с переспросом; чужой Telegram — «Это не ваш заказ»; «Да» — заказ завершён; повтор — «уже не ждёт», деньги — один раз',
      !!delivered && !!question && yes?.callback_data === `cy:${order.id}` && afterAsk === 'delivered' && !!foreign &&
        afterForeign === 'delivered' && questionId > 0 && confirmed?.body.message_id === questionId && (await status()) === 'completed' &&
        !!again && releases === 1,
      JSON.stringify({ delivered: !!delivered, question: question?.body.text, afterAsk, foreign: !!foreign, afterForeign, confirmed: confirmed?.body, again: again?.body.text, releases }),
    );
    // Сообщение в чат заказа — продавцу в Telegram с «Ответить»; ответ уходит в чат.
    const conv = (await k('/conversations', { token: buyer.token })).body.find((c) => c.orderId === order.id);
    await k(`/conversations/${conv.id}/messages`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Всё пришло, спасибо' }) });
    const incoming = await waitFor(() =>
      tg.to(SELLER_CHAT).find((c) => c.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === `rp:${conv.id}`),
    );
    const incomingId = incoming?.result?.message_id;
    await mapped(SELLER_CHAT, incomingId);
    await hook({ message: { message_id: 99, text: 'Рад, что всё дошло', chat: { id: SELLER_CHAT, type: 'private' }, from: { id: SELLER_CHAT }, reply_to_message: { message_id: incomingId } } });
    const sentNote = await waitFor(() => tg.to(SELLER_CHAT).find((c) => /^Отправлено в чат с @tgb/.test(c.body.text ?? '')));
    // Ответ на сообщение, которого бот в этот чат не присылал, в диалог не уходит.
    await hook({ message: { message_id: 98, text: 'подделка', chat: { id: BUYER_CHAT, type: 'private' }, from: { id: BUYER_CHAT }, reply_to_message: { message_id: 9999 } } });
    await wait(500);
    const history = (await k(`/conversations/${conv.id}/messages`, { token: buyer.token })).body;
    const bodies = (history.items ?? history).map((m) => `${m.senderId === seller.id ? 'S' : m.senderId === buyer.id ? 'B' : '-'}:${m.body}`);
    check(
      'Telegram: сообщение покупателя — продавцу с «Ответить»; ответ на него — в чат от продавца; ответ на чужое сообщение — нет',
      incomingId > 0 && !!sentNote && bodies.includes('S:Рад, что всё дошло') && !bodies.some((b) => b.endsWith('подделка')),
      JSON.stringify({ incoming: incoming?.body.text, sentNote: sentNote?.body.text, bodies: bodies.slice(-4) }),
    );
    // Заготовка с {имя}: под сообщением — «Заготовки», список кнопками, выбранная уходит в чат с ником покупателя.
    const tpl = await k('/seller-tools/templates', {
      method: 'POST', token: seller.token,
      body: JSON.stringify({ title: 'Спасибо', body: '{имя}, спасибо за покупку. Буду рад отзыву.' }),
    });
    await k(`/conversations/${conv.id}/messages`, { method: 'POST', token: buyer.token, body: JSON.stringify({ body: 'Отзыв оставил' }) });
    const withTpl = await waitFor(() =>
      tg.to(SELLER_CHAT).find((c) => c.body.reply_markup?.inline_keyboard?.[0]?.[1]?.callback_data === `tl:${conv.id}`),
    );
    await press(SELLER_CHAT, `tl:${conv.id}`, withTpl?.result?.message_id);
    const list = await waitFor(() => tg.to(SELLER_CHAT).find((c) => /^Какую заготовку прислать @tgb/.test(c.body.text ?? '')));
    const pick = list?.body.reply_markup?.inline_keyboard?.[0]?.[0];
    await mapped(SELLER_CHAT, list?.result?.message_id);
    // Та же кнопка на сообщении, которое бот не связывал с диалогом, ничего не отправляет.
    await press(SELLER_CHAT, pick?.callback_data, 9998);
    const stale = await waitFor(() => tg.to(SELLER_CHAT).find((c) => /устарела/.test(c.body.text ?? '')));
    await press(SELLER_CHAT, pick?.callback_data, list?.result?.message_id);
    const tplSent = await waitFor(() =>
      tg.to(SELLER_CHAT).find((c) => c.method === 'editMessageText' && /^Отправлено в чат с @tgb\d+: «Спасибо»/.test(c.body.text ?? '')),
    );
    const history2 = (await k(`/conversations/${conv.id}/messages`, { token: buyer.token })).body;
    const fromSeller = (history2.items ?? history2).filter((m) => m.senderId === seller.id).map((m) => m.body);
    check(
      'Telegram: продавцу с заготовками — «Заготовки» под сообщением; выбранная уходит в чат с ником покупателя, кнопка не из списка — нет',
      tpl.status === 201 && !!withTpl && pick?.callback_data === `tu:${tpl.body.id}` && !!stale && !!tplSent &&
        tplSent.body.message_id === list?.result?.message_id &&
        fromSeller.filter((b) => b === `tgb${rnd}, спасибо за покупку. Буду рад отзыву.`).length === 1,
      JSON.stringify({ tpl: tpl.status, withTpl: withTpl?.body.reply_markup, list: list?.body, stale: !!stale, tplSent: tplSent?.body.text, fromSeller: fromSeller.slice(-3) }),
    );
  } finally {
    child.kill();
    tg.close();
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
  await scenarioSellerTools(rnd);
  await scenarioSavedSearches(rnd);
  await scenarioPriceDrop(rnd);
  await scenarioLotStats(rnd);
  await scenarioSale(rnd);
  await scenarioSellerPromo(rnd);
  await scenarioFollow(rnd);
  await scenarioFollowFeed(rnd);
  await scenarioQtyDiscount(rnd);
  await scenarioBulkPrice(rnd);
  await scenarioPriceHistory(rnd);
  await scenarioHonestSale(rnd);
  await scenarioPriceLow(rnd);
  await scenarioStockWatch(rnd);
  await scenarioRecentCards(rnd);
  await scenarioPriceStats(rnd);
  await scenarioImport(rnd);
  await scenarioExportEdit(rnd);
  await scenarioBuyerReview(rnd);
  await scenarioSellerToday(rnd);
  await scenarioLoginAlert(rnd);
  await scenarioPasswordChanged(rnd);
  await scenarioTwoFactorAlert(rnd);
  await scenarioRecovery(rnd);
  await scenarioRecoveryNewEmail(rnd);
  await scenarioRecoveryDeals(rnd);
  await scenarioEmailChange(rnd);
  await scenarioReports(rnd);
  await scenarioDisputes(rnd);
  await scenarioNotificationsPage(rnd);
  await scenarioMyReviews(rnd);
  await scenarioReviewPhotos(rnd);
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
  await scenarioTelegramBot(rnd);

  const passed = results.filter(Boolean).length;
  console.log(`\n=== E2E: ${passed}/${results.length} проверок пройдено ===`);
  await prisma.$disconnect().catch(() => {});
  process.exit(passed === results.length ? 0 : 1);
})().catch(async (e) => {
  console.error('E2E FAIL', e);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
