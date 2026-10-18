/**
 * Сквозные e2e-тесты денежных путей против запущенного API + БД.
 * Запуск: API_URL=http://localhost:4090 DATABASE_URL=... node apps/api/test/e2e.mjs
 * Покрывает: эскроу-покупка, авто-выдача ключей, пополнение на сумму покупателя,
 * продажа поштучно (наличие, перепродажа последней штуки), способы оплаты (надбавка карты,
 * второй платёж по заказу), модерация (жалобы, бан, заморозка, спор у арбитра),
 * аккаунт (чёрный список, профиль, пароль, сеансы), поддержка, выплаты (с холдом и ролью finance).
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
  await j(`/account/blocks/${buyer.id}`, { method: 'DELETE', token: seller.token });
  check('Убрал из списка — снова можно купить', (await j('/orders', { method: 'POST', token: buyer.token, body: JSON.stringify({ listingId: lot }) })).status === 201);

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
  await scenarioAccount(rnd);
  await scenarioSupport(rnd);
  await scenarioCatalog(rnd);
  await scenarioBuyerData(rnd);
  await scenarioPromotion(rnd);
  await scenarioRates(rnd);
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
