/**
 * Демо-витрина: продавцы и лоты в разделах справочника (`catalog.ts`).
 *
 * Зачем отдельно от `seed.ts`. Базовый сид кладёт одну игру и ноль лотов,
 * поэтому свежеподнятый маркетплейс выглядит как пустая страница с надписью
 * «Пока пусто, выполните pnpm db:seed». Весь каталог, чат, заказы и эскроу
 * написаны и покрыты тестами — но показать их нельзя: до них не дойти.
 *
 * Здесь данные, на которых продукт видно. Они **демонстрационные** и помечены
 * так явно: у продавцов адреса на `@demo.gamemarket.local`, профили несут
 * пометку в биографии, а витрина подписывает их лоты «Пример»
 * (`isDemoSeller` в shared).
 *
 * Рейтингов, отзывов и продаж у демо-продавцов нет — ноль. Раньше здесь
 * стояли 4.9 и 187 продаж «для наглядности уровней», и витрина показывала
 * выдуманную репутацию рядом с надписью «Отзывов пока нет».
 *
 * Авто-лоты получают демо-ключи на склад: без них покупка ключа сразу
 * уходила в возврат, и самый короткий путь покупки на показе ломался.
 *
 * Запуск: `pnpm --filter @gamemarket/db seed:demo`
 * Идемпотентен: повторный запуск ничего не дублирует.
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { FulfillmentType, ListingStatus, PrismaClient } from '@prisma/client';
import { seedCatalog } from './catalog';

const prisma = new PrismaClient();

import { DEMO_EMAIL_DOMAIN as DEMO_DOMAIN, DEMO_SELLER_USERNAMES } from '../../shared/src/demo';
import { topupQuote, topupTermsError } from '../../shared/src/topup';
import { qtyTermsError } from '../../shared/src/quantity';
const DEMO_NOTE = 'Демонстрационный профиль витрины.';

interface DemoSeller {
  username: string;
  displayName: string;
  salesCount: number;
  ratingAvg: number;
  ratingCount: number;
}

/**
 * Демо-продавцы. У всех ноль продаж и отзывов: выдуманная репутация на
 * витрине обманывала бы покупателя, даже на стенде. Специализация — чтобы
 * разделы выглядели как рынок, где у каждого продавца своё дело.
 */
const SELLERS: DemoSeller[] = [
  { username: 'novichok', displayName: 'Первый лот', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'stabilno', displayName: 'Стабильный', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'keystore', displayName: 'Склад ключей', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'goldsmith', displayName: 'Золото и валюта', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'boostlab', displayName: 'Буст и прокачка', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'mobilka', displayName: 'Мобильный донат', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'subshop', displayName: 'Подписки и сервисы', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'rpgarage', displayName: 'RP-проекты', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
];
// Список продавцов витрины и пометка «Пример» должны совпадать.
if (SELLERS.some((s) => !(DEMO_SELLER_USERNAMES as readonly string[]).includes(s.username))) {
  throw new Error('Продавец сида не внесён в DEMO_SELLER_USERNAMES (packages/shared/src/demo.ts)');
}

/** Сколько демо-ключей держать на складе авто-лота. */
const DEMO_KEYS_PER_LOT = 5;

/** То же шифрование, что в EncryptionService API: ключи лежат только зашифрованными. */
function encrypt(plain: string): string {
  const key = createHash('sha256')
    .update(process.env.DATA_ENCRYPTION_KEY ?? 'dev-insecure-key')
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join(':');
}

interface DemoListing {
  game: string;
  category: string;
  seller: string;
  title: string;
  description: string;
  /** Цена в рублях — в базу уходит в копейках. */
  priceRub: number;
  stock?: number;
  auto?: boolean;
  /** Пополнение на сумму покупателя: цена лота считается из условий («от»). */
  topup?: { markupBps: number; minRub: number; maxRub: number };
  /** Поштучно: priceRub — цена за perUnits единиц, покупатель выбирает количество. */
  qty?: { unit: string; perUnits: number; minQty: number; stock: number };
  /** Прежнее название лота: стенды, поднятые до смены, получают его обновлённым. */
  legacyTitle?: string;
  /** Параметры раздела (звание, регион) — колонки таблицы раздела. */
  attributes?: Record<string, string | boolean>;
}

/** Короткая запись лота: «игра/раздел», продавец, название, цена в рублях, описание. */
const lot = (
  where: string,
  seller: string,
  title: string,
  priceRub: number,
  description: string,
  extra: Partial<DemoListing> = {},
): DemoListing => {
  const [game, category] = where.split('/') as [string, string];
  return { game, category, seller, title, priceRub, description, ...extra };
};

/**
 * Демо-лоты в популярных разделах справочника. Параметры и пачки валюты
 * сверяются со справочником при сиде (`checkAgainstCatalog`): опечатка в
 * сервере или ранге падает сразу, а не тихо выпадает из фильтров.
 */
const LISTINGS: DemoListing[] = [
  // ── Counter-Strike 2 ──
  lot('cs2/accounts', 'stabilno', 'Аккаунт CS2, Prime, 1200 часов', 3400,
    'Прайм активирован, звание Gold Nova. Почта передаётся вместе с аккаунтом, привязок нет. Смена почты и пароля — при вас, в чате сделки.',
    { attributes: { rank: 'Gold Nova', region: 'CIS', prime: true, delivery: 'Со сменой почты' } }),
  lot('cs2/accounts', 'novichok', 'Аккаунт CS2 без прайма, 150 часов', 390,
    'Чистый аккаунт без банов, подойдёт как второй. Данные для входа — после оплаты.',
    { attributes: { rank: 'Silver', region: 'CIS', prime: false, delivery: 'Данные без входа' } }),
  lot('cs2/accounts', 'boostlab', 'Аккаунт CS2, Global Elite, Prime', 12900,
    'Звание Global Elite, 3 400 часов, медали за сервис. Полная передача почты.',
    { attributes: { rank: 'Global Elite', region: 'EU', prime: true, delivery: 'Со сменой почты' } }),
  lot('cs2/accounts', 'stabilno', 'Аккаунт CS2, Supreme, медаль 2020', 7400,
    'Supreme Master First Class, медаль за 2020 год, инвентарь не передаётся.',
    { attributes: { rank: 'Supreme', region: 'EU', prime: true, delivery: 'Со сменой почты' } }),
  lot('cs2/accounts', 'novichok', 'Аккаунт CS2, Prime, 40 часов', 1990,
    'Прайм куплен месяц назад, звание Master Guardian. Перепривязка мобильного аутентификатора при вас.',
    { attributes: { rank: 'Master Guardian', region: 'EU', prime: true, delivery: 'Перепривязка' } }),
  lot('cs2/skins', 'stabilno', 'AK-47 Redline, Field-Tested', 1190,
    'Обмен через Steam после подтверждения сделки. Трейд-бан снят.',
    { attributes: { rarity: 'Classified' } }),
  lot('cs2/skins', 'keystore', 'AWP Asiimov, Battle-Scarred', 2890,
    'Передача обменом в Steam, ссылку на обмен пришлите в чат сделки.',
    { attributes: { rarity: 'Covert' } }),
  lot('cs2/skins', 'novichok', 'Перчатки Hydra, Field-Tested', 9800,
    'Без наклеек и неймтега. Обмен сразу после оплаты.',
    { attributes: { rarity: 'Нож/Перчатки' } }),
  lot('cs2/skins', 'stabilno', 'M4A1-S Printstream, Minimal Wear', 14500,
    'StatTrak, счётчик 1 200 убийств. Обмен в течение часа.',
    { attributes: { rarity: 'Covert', stattrak: true } }),
  lot('cs2/skins', 'keystore', 'Glock-18 Water Elemental, Factory New', 690,
    'Float 0.04. Передача через обмен.',
    { attributes: { rarity: 'Restricted' } }),
  lot('cs2/keys', 'keystore', 'Ключ от кейса Dreams & Nightmares', 219,
    'Выдача сразу после оплаты, из склада. Ключ не активирован.',
    { auto: true, attributes: { region: 'Global', platform: 'Steam' } }),
  lot('cs2/keys', 'keystore', 'Ключ от кейса Revolution', 249,
    'Выдача сразу после оплаты. Ключ подходит к любому аккаунту.',
    { auto: true, attributes: { region: 'Global', platform: 'Steam' } }),
  lot('cs2/service', 'boostlab', 'Буст звания до Gold Nova, 3 дня', 1500,
    'Играю сам, без читов и сторонних программ. Отчёт по каждому матчу в чат сделки.',
    { attributes: { kind: 'Буст звания' } }),
  lot('cs2/service', 'boostlab', 'Калибровка Premier, 10 матчей', 2200,
    'Десять калибровочных матчей, средний результат — 12 000 рейтинга.',
    { attributes: { kind: 'Калибровка' } }),

  // ── Dota 2 ──
  lot('dota2/accounts', 'boostlab', 'Аккаунт Dota 2, Ancient, 3000 часов', 2600,
    'Порядочность 10 000, без банов поиска. Почта передаётся.',
    { attributes: { rank: 'Ancient' } }),
  lot('dota2/accounts', 'novichok', 'Аккаунт Dota 2 с арканами, Legend', 5400,
    'Три арканы, 45 сетов, звание Legend. Полная передача.',
    { attributes: { rank: 'Legend' } }),
  lot('dota2/items', 'novichok', 'Arcana Juggernaut', 2100,
    'Подарком через Steam, трейд-лок 30 дней учтён в цене.',
    { attributes: { rarity: 'Arcana' } }),
  lot('dota2/items', 'stabilno', 'Сет на Pudge, Immortal', 420,
    'Обмен в Steam после оплаты.',
    { attributes: { rarity: 'Immortal' } }),
  lot('dota2/service', 'stabilno', 'Калибровка MMR, 5 игр', 2500,
    'Играю сам, без ботов и без передачи аккаунта третьим лицам. Отчёт по каждой игре в чат сделки.',
    { attributes: { kind: 'Калибровка' } }),
  lot('dota2/service', 'boostlab', 'Буст MMR +500, от Archon', 3200,
    'Срок 3–4 дня. Играю на ваших героях, если попросите.',
    { attributes: { kind: 'Буст MMR' } }),

  // ── Steam ──
  lot('steam/topup', 'keystore', 'Пополнение кошелька Steam', 0,
    'Любая сумма от 100 до 15 000 ₽. Нужен только логин Steam, пароль не нужен. Зачисление за несколько минут после оплаты.',
    { auto: true, topup: { markupBps: 800, minRub: 100, maxRub: 15_000 }, legacyTitle: 'Пополнение кошелька Steam, 1000 ₽' }),
  lot('steam/keys', 'keystore', 'Ключ Baldur’s Gate 3, регион РФ', 2790,
    'Активация в Steam. Выдача автоматическая после оплаты.',
    { auto: true, attributes: { region: 'Россия' } }),
  lot('steam/keys', 'keystore', 'Ключ Elden Ring, СНГ', 2190,
    'Активация в Steam, регион СНГ. Выдача сразу после оплаты.',
    { auto: true, attributes: { region: 'СНГ' } }),
  lot('steam/gifts', 'subshop', 'Гифт Hollow Knight', 290,
    'Отправлю подарком в Steam в течение часа. Нужна ссылка на профиль.',
    { attributes: { region: 'Россия' } }),
  lot('steam/accounts', 'novichok', 'Steam-аккаунт с 40 играми', 1900,
    'В библиотеке Witcher 3, Terraria, Portal 2 и другие. Почта передаётся.'),

  // ── Roblox ──
  lot('roblox/currency', 'keystore', 'Robux через геймпасс, от 400', 69,
    'Через геймпасс. Нужен ник и открытая группа. Количество выбираете сами, от 400 Robux.',
    { qty: { unit: 'Robux', perUnits: 100, minQty: 400, stock: 200_000 }, legacyTitle: '1000 Robux на аккаунт' }),
  lot('roblox/currency', 'mobilka', 'Robux на аккаунт, от 200', 72,
    'Через геймпасс, зачисление после пяти дней ожидания Roblox. Ник — в форме заказа.',
    { qty: { unit: 'Robux', perUnits: 100, minQty: 200, stock: 50_000 } }),
  lot('roblox/items', 'mobilka', 'Питомцы Adopt Me, неоновые', 350,
    'Передача в игре трейдом. Время согласуем в чате.',
    { attributes: { mode: 'Adopt Me' } }),
  lot('roblox/items', 'novichok', 'Фрукт Dragon, Blox Fruits', 890,
    'Передача трейдом в игре, нужен второй уровень моря.',
    { attributes: { mode: 'Blox Fruits' } }),
  lot('roblox/accounts', 'novichok', 'Аккаунт Roblox 2016 года', 2400,
    'Редкие лимитки, почта передаётся.'),

  // ── Genshin Impact ──
  lot('genshin/accounts', 'stabilno', 'Аккаунт AR 55, четыре пятизвёздочных', 7900,
    'Полная передача почты. Список персонажей и оружия — в чате.',
    { attributes: { server: 'Europe' } }),
  lot('genshin/accounts', 'novichok', 'Стартовый аккаунт, Райдэн и Нахида', 1490,
    'Ранг приключений 20, оба персонажа без созвездий. Почта передаётся.',
    { attributes: { server: 'Europe' } }),
  lot('genshin/accounts', 'boostlab', 'Аккаунт AR 60, Фурина C2', 15900,
    'Двенадцать пятизвёздочных, полная бездна. Полная передача.',
    { attributes: { server: 'Asia' } }),
  lot('genshin/topup', 'keystore', 'Кристаллы сотворения, 3280', 4190,
    'По UID, без входа в аккаунт. Зачисление до получаса.',
    { auto: true }),
  lot('genshin/service', 'boostlab', 'Исследование Натлана на 100%', 1200,
    'Сундуки, головоломки и очки статуи. Срок — два дня.',
    { attributes: { kind: 'Исследование мира' } }),

  // ── Brawl Stars ──
  lot('brawl-stars/accounts', 'novichok', 'Аккаунт 32 кубка, 18 бойцов', 1450,
    'Привязка Supercell ID передаётся полностью.'),
  lot('brawl-stars/accounts', 'mobilka', 'Аккаунт 45 000 кубков, все легендарные', 6900,
    'Все бойцы, 180 скинов. Перепривязка Supercell ID при вас.'),
  lot('brawl-stars/currency', 'mobilka', '170 гемов на аккаунт', 990,
    'Через вход в Supercell ID, код подтверждения — в чате сделки.'),
  lot('brawl-stars/service', 'boostlab', 'Буст бойца до 1000 кубков', 450,
    'Любой боец, срок — сутки.'),

  // ── Standoff 2 ──
  lot('standoff2/currency', 'mobilka', 'Голда Standoff 2, от 1 000', 55,
    'Через продажу скина на рынке, налог учтён. Количество выбираете сами.',
    { qty: { unit: 'голды', perUnits: 100, minQty: 1000, stock: 300_000 } }),
  lot('standoff2/items', 'stabilno', 'Набор скинов: AWP Dragon + нож', 2300,
    'Передача через внутриигровой обмен, при вас.'),
  lot('standoff2/accounts', 'novichok', 'Аккаунт Standoff 2, ранг Легенда', 1800,
    'Инвентарь на 3 000 голды. Привязка почты передаётся.'),

  // ── World of Tanks и Мир танков ──
  lot('wot/currency', 'keystore', 'Золото на аккаунт, от 2 500', 310,
    'По логину, без передачи пароля. Количество выбираете сами, от 2 500 золота. Зачисление в день покупки.',
    { qty: { unit: 'золота', perUnits: 1000, minQty: 2500, stock: 5_000_000 }, legacyTitle: '6500 золота на аккаунт' }),
  lot('wot/service', 'stabilno', 'Прокачка ветки до 10 уровня', 5600,
    'Срок 7–10 дней, отчёт по этапам. Без использования модов.',
    { attributes: { kind: 'Прокачка ветки' } }),
  lot('wot/accounts', 'novichok', 'Аккаунт WoT, 12 машин 10 уровня', 8900,
    'Сервер EU, премиум-танки в ангаре. Почта передаётся.',
    { attributes: { region: 'EU' } }),
  lot('mir-tankov/currency', 'goldsmith', 'Золото Мир танков, от 1 250', 290,
    'Бонус-кодами, без входа в аккаунт. Количество выбираете сами.',
    { qty: { unit: 'золота', perUnits: 1000, minQty: 1250, stock: 2_000_000 } }),
  lot('mir-tankov/accounts', 'novichok', 'Аккаунт Мир танков, пять машин 10 уровня', 4500,
    'Полная передача почты и телефона.'),
  lot('mir-tankov/service', 'boostlab', 'Три отметки на стволе', 2500,
    'Любой танк 8–10 уровня, срок — неделя.',
    { attributes: { kind: 'Отметки на стволе' } }),

  // ── World of Warcraft ──
  lot('wow/currency', 'goldsmith', 'Золото, Гордунни, Орда', 1.45,
    'Передача через почту или аукцион, за 15 минут. От 100 000 золота.',
    { qty: { unit: 'золота', perUnits: 1000, minQty: 100_000, stock: 50_000_000 }, attributes: { server: 'Гордунни', side: 'Орда' } }),
  lot('wow/currency', 'goldsmith', 'Золото, Азурегос, Альянс', 1.39,
    'Передача через почту. От 100 000 золота, оптом дешевле — напишите.',
    { qty: { unit: 'золота', perUnits: 1000, minQty: 100_000, stock: 30_000_000 }, attributes: { server: 'Азурегос', side: 'Альянс' } }),
  lot('wow/currency', 'stabilno', 'Золото, Свежеватель Душ, Орда', 1.52,
    'Передача через аукцион. От 200 000 золота.',
    { qty: { unit: 'золота', perUnits: 1000, minQty: 200_000, stock: 10_000_000 }, attributes: { server: 'Свежеватель Душ', side: 'Орда' } }),
  lot('wow/service', 'boostlab', 'Эпохальные+ подземелья, ключ +10', 1800,
    'Проходка с группой, лут ваш. Время согласуем в чате.',
    { attributes: { kind: 'Эпохальные+ подземелья' } }),
  lot('wow/service', 'boostlab', 'Прокачка персонажа с 70 до 80 уровня', 2900,
    'Срок — два дня, без ботов.',
    { attributes: { kind: 'Прокачка' } }),
  lot('wow/accounts', 'novichok', 'Аккаунт WoW, три персонажа 80 уровня', 6500,
    'Аккаунт Battle.net с подпиской до конца месяца. Полная передача.'),
  lot('wow-classic/currency', 'goldsmith', 'Золото Classic, Пламегор, Орда', 25,
    'Передача через почту. От 50 золота.',
    { qty: { unit: 'золота', perUnits: 10, minQty: 50, stock: 20_000 }, attributes: { server: 'Пламегор, Орда' } }),

  // ── Fortnite и Valorant ──
  lot('fortnite/accounts', 'novichok', 'Аккаунт Fortnite, 120 скинов, Чёрный рыцарь', 9900,
    'Полная передача Epic-аккаунта. Платформа — PC.',
    { attributes: { platform: 'PC' } }),
  lot('fortnite/donate', 'mobilka', '1000 В-баксов на аккаунт', 690,
    'Через вход в Epic, код подтверждения — в чате сделки.'),
  lot('valorant/accounts', 'boostlab', 'Аккаунт Valorant, Immortal 2', 6900,
    'Регион EU, 20 скинов на оружие. Полная передача.',
    { attributes: { region: 'EU', rank: 'Immortal' } }),
  lot('valorant/accounts', 'novichok', 'Аккаунт Valorant с 15 скинами, Gold', 2300,
    'Регион EU, почта передаётся.',
    { attributes: { region: 'EU', rank: 'Gold' } }),
  lot('valorant/donate', 'mobilka', '1000 Valorant Points, регион EU', 990,
    'Кодом пополнения, выдача в чате сделки.'),
  lot('valorant/service', 'boostlab', 'Буст ранга с Silver до Gold', 2700,
    'Срок — три дня. Можно играть дуо.',
    { attributes: { kind: 'Буст рейтинга' } }),

  // ── Minecraft ──
  lot('minecraft/accounts', 'subshop', 'Лицензия Minecraft Java, полный доступ', 1490,
    'Аккаунт Microsoft, смена почты при вас.',
    { attributes: { edition: 'Java' } }),
  lot('minecraft/accounts', 'novichok', 'Minecraft Java и Bedrock со сменой почты', 2190,
    'Обе версии на одном аккаунте Microsoft.',
    { attributes: { edition: 'Java и Bedrock' } }),
  lot('minecraft/keys', 'keystore', 'Ключ Minecraft Bedrock для Windows', 990,
    'Активация в Microsoft Store. Выдача сразу после оплаты.',
    { auto: true }),
  lot('minecraft/service', 'boostlab', 'Постройка средневекового замка', 1500,
    'На вашем сервере или в одиночном мире, срок — три дня.',
    { attributes: { kind: 'Постройки' } }),

  // ── GTA V и GTA 5 RP ──
  lot('gta5/currency', 'goldsmith', 'Деньги GTA Online, PC, от 10 млн', 89,
    'Через ограбление в лобби, безопасно для аккаунта. Количество выбираете сами.',
    { qty: { unit: '$', perUnits: 1_000_000, minQty: 10_000_000, stock: 1_000_000_000 }, attributes: { platform: 'PC' } }),
  lot('gta5/currency', 'stabilno', 'Деньги GTA Online, PlayStation, от 5 млн', 99,
    'Через лобби, нужен PS Plus. Количество выбираете сами.',
    { qty: { unit: '$', perUnits: 1_000_000, minQty: 5_000_000, stock: 300_000_000 }, attributes: { platform: 'PlayStation' } }),
  lot('gta5/accounts', 'novichok', 'Аккаунт GTA Online, 500 уровень', 3900,
    'Все бизнесы, 40 машин. Платформа — PC.',
    { attributes: { platform: 'PC' } }),
  lot('gta5/keys', 'keystore', 'Ключ GTA V Premium Edition', 1290,
    'Активация в Rockstar Games Launcher. Выдача сразу после оплаты.',
    { auto: true, attributes: { region: 'Глобальный' } }),
  lot('gta5rp/currency', 'rpgarage', 'Вирты Downtown, от 5 млн', 65,
    'Передача через банк в игре. Количество выбираете сами.',
    { qty: { unit: 'виртов', perUnits: 1_000_000, minQty: 5_000_000, stock: 500_000_000 }, attributes: { server: 'Downtown' } }),
  lot('gta5rp/currency', 'rpgarage', 'Вирты Strawberry, переводом в банк', 69,
    'Перевод в течение 15 минут. Количество выбираете сами.',
    { qty: { unit: 'виртов', perUnits: 1_000_000, minQty: 3_000_000, stock: 200_000_000 }, attributes: { server: 'Strawberry' } }),
  lot('gta5rp/currency', 'goldsmith', 'Вирты Vinewood', 62,
    'Передача через банк или продажу машины. От 10 млн.',
    { qty: { unit: 'виртов', perUnits: 1_000_000, minQty: 10_000_000, stock: 900_000_000 }, attributes: { server: 'Vinewood' } }),
  lot('gta5rp/items', 'rpgarage', 'Дом с гаражом на Downtown', 12000,
    'Передача через продажу в игре, время согласуем в чате.'),
  lot('gta5rp/accounts', 'rpgarage', 'Персонаж 15 уровня, Strawberry', 4900,
    'Работа в полиции, права всех категорий.'),

  // ── Escape from Tarkov ──
  lot('tarkov/accounts', 'stabilno', 'Аккаунт EFT Edge of Darkness, 52 уровень', 8900,
    'Каппа не получена, торговцы 4 уровня. Полная передача.',
    { attributes: { edition: 'Edge of Darkness' } }),
  lot('tarkov/currency', 'goldsmith', 'Рубли Таркова, от 5 млн', 199,
    'Передача через барахолку в течение часа. Количество выбираете сами.',
    { qty: { unit: 'рублей', perUnits: 1_000_000, minQty: 5_000_000, stock: 300_000_000 } }),
  lot('tarkov/service', 'boostlab', 'Помощь с квестами Егеря', 2500,
    'Сопровождаю в рейдах до выполнения, срок — неделя.',
    { attributes: { kind: 'Квесты' } }),

  // ── EA Sports FC ──
  lot('fc/currency', 'goldsmith', 'Монеты FC 26, PlayStation, от 500 тыс.', 349,
    'Комфорт-трейд, без риска для аккаунта. Количество выбираете сами.',
    { qty: { unit: 'монет', perUnits: 100_000, minQty: 500_000, stock: 50_000_000 }, attributes: { platform: 'PlayStation' } }),
  lot('fc/currency', 'goldsmith', 'Монеты FC 26, PC', 399,
    'Комфорт-трейд. Количество выбираете сами.',
    { qty: { unit: 'монет', perUnits: 100_000, minQty: 500_000, stock: 30_000_000 }, attributes: { platform: 'PC' } }),
  lot('fc/donate', 'mobilka', '2800 FC Points, PlayStation', 2290,
    'Через вход в аккаунт, код подтверждения — в чате сделки.'),

  // ── Telegram и Discord ──
  lot('telegram/stars', 'subshop', 'Звёзды Telegram по нику, от 100', 165,
    'Отправка по юзернейму в течение 10 минут. Количество выбираете сами.',
    { qty: { unit: 'звёзд', perUnits: 100, minQty: 100, stock: 1_000_000 } }),
  lot('telegram/stars', 'mobilka', 'Звёзды Telegram, быстро', 175,
    'Отправка подарком на ваш ник. Количество выбираете сами.',
    { qty: { unit: 'звёзд', perUnits: 100, minQty: 50, stock: 200_000 } }),
  lot('telegram/premium', 'subshop', 'Telegram Premium на 3 месяца', 1190,
    'Подарком на ваш аккаунт, вход не нужен.',
    { attributes: { term: '3 месяца' } }),
  lot('telegram/premium', 'subshop', 'Telegram Premium на 12 месяцев', 3290,
    'Подарком на ваш аккаунт, вход не нужен.',
    { attributes: { term: '12 месяцев' } }),
  lot('discord/nitro', 'subshop', 'Discord Nitro на месяц подарком', 590,
    'Ссылкой-подарком, активация на вашем аккаунте.',
    { attributes: { plan: 'Nitro', term: '1 месяц' } }),
  lot('discord/nitro', 'subshop', 'Nitro Basic на год', 2190,
    'Ссылкой-подарком, активация на вашем аккаунте.',
    { attributes: { plan: 'Nitro Basic', term: '12 месяцев' } }),

  // ── Мобильные игры ──
  lot('pubg-mobile/donate', 'mobilka', '660 UC по ID', 790,
    'По игровому ID, без входа в аккаунт. Зачисление до часа.'),
  lot('pubg-mobile/donate', 'mobilka', '1800 UC по ID', 1990,
    'По игровому ID, без входа в аккаунт.'),
  lot('pubg-mobile/accounts', 'novichok', 'Аккаунт PUBG Mobile, завоеватель, M416 Glacier', 4900,
    'Привязка к почте передаётся, мифические костюмы.'),
  lot('mlbb/donate', 'mobilka', '257 алмазов по ID', 420,
    'По ID и серверу, без входа.'),
  lot('mlbb/service', 'boostlab', 'Буст ранга до Mythic', 3500,
    'Срок — пять дней, играю сам.',
    { attributes: { kind: 'Буст рейтинга' } }),

  // ── Сервисы ──
  lot('spotify/premium', 'subshop', 'Spotify Premium Individual на 12 месяцев', 1990,
    'На ваш аккаунт, через семейную подписку.',
    { attributes: { plan: 'Individual', term: '12 месяцев' } }),
  lot('playstation/accounts', 'subshop', 'Турецкий аккаунт PSN', 490,
    'Новый аккаунт для покупок в турецком PS Store.',
    { attributes: { region: 'Турция' } }),
  lot('playstation/ps-plus', 'subshop', 'PS Plus Extra на 12 месяцев, Турция', 3990,
    'Активация на ваш турецкий аккаунт.',
    { attributes: { tier: 'Extra', term: '12 месяцев' } }),
  lot('playstation/cards', 'keystore', 'Карта пополнения PSN, 1000 TL', 3290,
    'Код выдаётся сразу после оплаты, для турецкого аккаунта.',
    { auto: true, attributes: { region: 'Турция' } }),
];

async function upsertSellers() {
  for (const s of SELLERS) {
    const email = `${s.username}${DEMO_DOMAIN}`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      // Пароля нет намеренно: под этими учётками нельзя войти, они только
      // наполняют витрину. Вход с пустым `passwordHash` невозможен.
      create: { email, status: 'active' },
    });
    await prisma.profile.upsert({
      where: { userId: user.id },
      update: {
        displayName: s.displayName,
        bio: DEMO_NOTE,
        salesCount: s.salesCount,
        ratingAvg: s.ratingAvg,
        ratingCount: s.ratingCount,
      },
      create: {
        userId: user.id,
        username: s.username,
        displayName: s.displayName,
        bio: DEMO_NOTE,
        salesCount: s.salesCount,
        ratingAvg: s.ratingAvg,
        ratingCount: s.ratingCount,
      },
    });
  }
}

async function upsertListings() {
  for (const l of LISTINGS) {
    const game = await prisma.game.findUnique({ where: { slug: l.game } });
    if (!game) throw new Error(`Демо-лот «${l.title}»: игры ${l.game} нет в справочнике`);
    const category = await prisma.category.findUnique({
      where: { gameId_slug: { gameId: game.id, slug: l.category } },
      include: { attributes: true },
    });
    if (!category) throw new Error(`Демо-лот «${l.title}»: раздела ${l.game}/${l.category} нет в справочнике`);
    checkAgainstCatalog(l, category);
    const seller = await prisma.user.findUnique({
      where: { email: `${l.seller}${DEMO_DOMAIN}` },
    });
    if (!seller) continue;

    const terms = topupTermsOf(l);
    const qty = qtyTermsOf(l);
    const price = terms ? topupQuote(terms.min, terms.markupBps).price : BigInt(Math.round(l.priceRub * 100));

    const exists = await prisma.listing.findFirst({
      where: { sellerId: seller.id, title: { in: [l.title, ...(l.legacyTitle ? [l.legacyTitle] : [])] } },
      select: { id: true },
    });
    if (exists) {
      if (category.fulfillmentType === FulfillmentType.auto_key) await refillDemoKeys(exists.id);
      if (l.attributes) await prisma.listing.update({ where: { id: exists.id }, data: { attributes: l.attributes } });
      if (terms) {
        // Условия пополнения держим в согласии с сидом: стенд, поднятый до
        // смены, получает лот «на любую сумму» вместо фиксированного.
        await prisma.listing.update({
          where: { id: exists.id },
          data: {
            title: l.title,
            description: l.description,
            price,
            topupMarkupBps: terms.markupBps,
            topupMin: terms.min,
            topupMax: terms.max,
          },
        });
      }
      if (qty) {
        // Поштучный лот: условия как в сиде, наличие — снова полное, а
        // распроданный на прошлом показе лот возвращается в продажу.
        await prisma.listing.update({
          where: { id: exists.id },
          data: { title: l.title, description: l.description, price, ...qty },
        });
        await prisma.listing.updateMany({
          where: { id: exists.id, status: ListingStatus.sold_out },
          data: { status: ListingStatus.active },
        });
      }
      continue;
    }

    const created = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        gameId: game.id,
        categoryId: category.id,
        title: l.title,
        description: l.description,
        price,
        currency: 'RUB',
        attributes: l.attributes ?? {},
        stock: l.stock ?? null,
        ...qty,
        status: ListingStatus.active,
        fulfillmentType: category.fulfillmentType,
        autoDelivery: l.auto ?? false,
        topupMarkupBps: terms?.markupBps ?? null,
        topupMin: terms?.min ?? null,
        topupMax: terms?.max ?? null,
      },
    });
    if (category.fulfillmentType === FulfillmentType.auto_key) await refillDemoKeys(created.id);
  }
}

/**
 * Демо-лот против справочника: обязательные параметры есть, значения — из
 * списков, лишних ключей нет, пачка валюты — как у раздела. Ошибка падает
 * при сиде: иначе лот тихо выпадал бы из фильтров раздела.
 */
function checkAgainstCatalog(
  l: DemoListing,
  category: {
    unitName: string | null;
    pricePerUnits: number | null;
    attributes: Array<{ key: string; type: string; options: unknown; isRequired: boolean }>;
  },
) {
  const where = `Демо-лот «${l.title}» (${l.game}/${l.category})`;
  const attrs = l.attributes ?? {};
  for (const key of Object.keys(attrs)) {
    if (!category.attributes.some((a) => a.key === key)) throw new Error(`${where}: у раздела нет параметра ${key}`);
  }
  for (const a of category.attributes) {
    const v = attrs[a.key];
    if (v === undefined) {
      if (a.isRequired) throw new Error(`${where}: нет обязательного параметра ${a.key}`);
      continue;
    }
    if (a.type === 'enum' && !(a.options as string[]).includes(String(v))) {
      throw new Error(`${where}: «${String(v)}» нет в списке ${a.key}`);
    }
  }
  if (category.unitName && category.pricePerUnits) {
    if (l.qty?.unit !== category.unitName || l.qty.perUnits !== category.pricePerUnits) {
      throw new Error(`${where}: раздел продаёт за ${category.pricePerUnits} ${category.unitName}`);
    }
  }
}

/** Условия продажи поштучно — с той же проверкой, что у API. */
function qtyTermsOf(l: DemoListing) {
  if (!l.qty) return null;
  const terms = {
    unitName: l.qty.unit,
    pricePerUnits: l.qty.perUnits,
    minQty: l.qty.minQty,
    stock: l.qty.stock,
  };
  const err = qtyTermsError(terms);
  if (err) throw new Error(`Поштучный лот «${l.title}»: ${err}`);
  return terms;
}

/** Условия пополнения из описания лота — с той же проверкой, что у API. */
function topupTermsOf(l: DemoListing) {
  if (!l.topup) return null;
  const terms = {
    markupBps: l.topup.markupBps,
    min: BigInt(l.topup.minRub * 100),
    max: BigInt(l.topup.maxRub * 100),
  };
  const err = topupTermsError(terms);
  if (err) throw new Error(`Условия пополнения «${l.title}»: ${err}`);
  return terms;
}

/** Держит на складе авто-лота DEMO_KEYS_PER_LOT свободных демо-ключей; stock = их число. */
async function refillDemoKeys(listingId: string) {
  const available = await prisma.digitalGood.count({ where: { listingId, status: 'available' } });
  const missing = DEMO_KEYS_PER_LOT - available;
  if (missing > 0) {
    await prisma.digitalGood.createMany({
      data: Array.from({ length: missing }, () => {
        const code = randomBytes(6).toString('hex').toUpperCase().match(/.{4}/g)!.join('-');
        return { listingId, payloadEnc: encrypt(`ПРИМЕР-${code} (демо-ключ, в игре не активируется)`) };
      }),
    });
  }
  await prisma.listing.update({
    where: { id: listingId },
    data: { stock: Math.max(available, DEMO_KEYS_PER_LOT) },
  });
  // Ключи раскупили на прошлом показе — лот ушёл из каталога; со свежими
  // ключами он снова в продаже.
  await prisma.listing.updateMany({
    where: { id: listingId, status: ListingStatus.sold_out },
    data: { status: ListingStatus.active },
  });
}

async function main() {
  // Игры и разделы — из справочника площадки: демо-лоты лежат в тех же
  // разделах, что и лоты продавцов.
  await seedCatalog(prisma);
  await upsertSellers();
  await upsertListings();
  const [games, listings] = await Promise.all([
    prisma.game.count({ where: { isActive: true } }),
    prisma.listing.count({ where: { status: ListingStatus.active } }),
  ]);
  console.log(`✅ Демо-витрина: игр ${games}, активных лотов ${listings}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
