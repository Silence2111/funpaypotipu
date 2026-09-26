/**
 * Демо-витрина: игры, категории, продавцы и лоты.
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
import {
  CategorySegment,
  FulfillmentType,
  ListingStatus,
  PrismaClient,
} from '@prisma/client';

const prisma = new PrismaClient();

import { DEMO_EMAIL_DOMAIN as DEMO_DOMAIN, DEMO_SELLER_USERNAMES } from '../../shared/src/demo';
const DEMO_NOTE = 'Демонстрационный профиль витрины.';

interface DemoGame {
  slug: string;
  title: string;
  sortOrder: number;
  categories: Array<{
    slug: string;
    title: string;
    segment: CategorySegment;
    fulfillmentType: FulfillmentType;
  }>;
}

const ACCOUNTS = {
  slug: 'accounts',
  title: 'Аккаунты',
  segment: CategorySegment.accounts,
  fulfillmentType: FulfillmentType.manual,
};
const CURRENCY = {
  slug: 'currency',
  title: 'Игровая валюта',
  segment: CategorySegment.currency,
  fulfillmentType: FulfillmentType.manual,
};
const ITEMS = {
  slug: 'items',
  title: 'Предметы',
  segment: CategorySegment.items,
  fulfillmentType: FulfillmentType.manual,
};
const SERVICE = {
  slug: 'service',
  title: 'Услуги и буст',
  segment: CategorySegment.service,
  fulfillmentType: FulfillmentType.manual,
};
const KEYS = {
  slug: 'keys',
  title: 'Ключи (авто-выдача)',
  segment: CategorySegment.key,
  fulfillmentType: FulfillmentType.auto_key,
};
const TOPUP = {
  slug: 'topup',
  title: 'Пополнение',
  segment: CategorySegment.topup,
  fulfillmentType: FulfillmentType.provider,
};

const GAMES: DemoGame[] = [
  { slug: 'cs2', title: 'Counter-Strike 2', sortOrder: 1, categories: [ACCOUNTS, ITEMS, KEYS] },
  { slug: 'dota2', title: 'Dota 2', sortOrder: 2, categories: [ACCOUNTS, ITEMS, SERVICE] },
  { slug: 'steam', title: 'Steam', sortOrder: 3, categories: [TOPUP, KEYS] },
  { slug: 'genshin', title: 'Genshin Impact', sortOrder: 4, categories: [ACCOUNTS, TOPUP, SERVICE] },
  { slug: 'roblox', title: 'Roblox', sortOrder: 5, categories: [CURRENCY, ACCOUNTS] },
  { slug: 'brawl-stars', title: 'Brawl Stars', sortOrder: 6, categories: [ACCOUNTS, CURRENCY] },
  { slug: 'standoff2', title: 'Standoff 2', sortOrder: 7, categories: [ACCOUNTS, CURRENCY, ITEMS] },
  { slug: 'wot', title: 'World of Tanks', sortOrder: 8, categories: [ACCOUNTS, CURRENCY, SERVICE] },
];

interface DemoSeller {
  username: string;
  displayName: string;
  salesCount: number;
  ratingAvg: number;
  ratingCount: number;
}

/** Три уровня продавца: на них видно, как работает скидка с комиссии. */
const SELLERS: DemoSeller[] = [
  { username: 'novichok', displayName: 'Первый лот', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'stabilno', displayName: 'Стабильный', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
  { username: 'keystore', displayName: 'Склад ключей', salesCount: 0, ratingAvg: 0, ratingCount: 0 },
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
}

const LISTINGS: DemoListing[] = [
  {
    game: 'cs2',
    category: 'accounts',
    seller: 'stabilno',
    title: 'Аккаунт CS2, Prime, 1200 часов',
    description:
      'Прайм активирован, звание Gold Nova. Почта передаётся вместе с аккаунтом, ' +
      'привязок нет. Смена почты и пароля — при вас, в чате сделки.',
    priceRub: 3400,
  },
  {
    game: 'cs2',
    category: 'items',
    seller: 'stabilno',
    title: 'AK-47 Redline, Field-Tested',
    description: 'Обмен через Steam после подтверждения сделки. Трейд-бан снят.',
    priceRub: 1190,
  },
  {
    game: 'cs2',
    category: 'keys',
    seller: 'keystore',
    title: 'Ключ от кейса Dreams & Nightmares',
    description: 'Выдача сразу после оплаты, из склада. Ключ не активирован.',
    priceRub: 219,
    auto: true,
  },
  {
    game: 'dota2',
    category: 'service',
    seller: 'stabilno',
    title: 'Калибровка MMR, 5 игр',
    description:
      'Играю сам, без ботов и без передачи аккаунта третьим лицам. ' +
      'Отчёт по каждой игре в чат сделки.',
    priceRub: 2500,
  },
  {
    game: 'dota2',
    category: 'items',
    seller: 'novichok',
    title: 'Arcana Juggernaut',
    description: 'Подарком через Steam, трейд-лок 30 дней учтён в цене.',
    priceRub: 2100,
  },
  {
    game: 'steam',
    category: 'topup',
    seller: 'keystore',
    title: 'Пополнение кошелька Steam, 1000 ₽',
    description: 'Зачисление в течение 15 минут. Нужен только логин Steam.',
    priceRub: 1080,
    auto: true,
  },
  {
    game: 'steam',
    category: 'keys',
    seller: 'keystore',
    title: 'Ключ Baldur’s Gate 3, регион РФ',
    description: 'Активация в Steam. Выдача автоматическая после оплаты.',
    priceRub: 2790,
    auto: true,
  },
  {
    game: 'genshin',
    category: 'topup',
    seller: 'keystore',
    title: 'Кристаллы сотворения, 3280',
    description: 'По UID, без входа в аккаунт. Зачисление до получаса.',
    priceRub: 4190,
    auto: true,
  },
  {
    game: 'genshin',
    category: 'accounts',
    seller: 'stabilno',
    title: 'Аккаунт AR 55, четыре пятизвёздочных',
    description: 'Полная передача почты. Список персонажей и оружия — в чате.',
    priceRub: 7900,
  },
  {
    game: 'roblox',
    category: 'currency',
    seller: 'keystore',
    title: '1000 Robux на аккаунт',
    description: 'Через геймпасс. Нужен ник и открытая группа.',
    priceRub: 690,
  },
  {
    game: 'brawl-stars',
    category: 'accounts',
    seller: 'novichok',
    title: 'Аккаунт 32 кубка, 18 бойцов',
    description: 'Привязка Supercell ID передаётся полностью.',
    priceRub: 1450,
  },
  {
    game: 'standoff2',
    category: 'items',
    seller: 'stabilno',
    title: 'Набор скинов: AWP Dragon + нож',
    description: 'Передача через внутриигровой обмен, при вас.',
    priceRub: 2300,
  },
  {
    game: 'wot',
    category: 'currency',
    seller: 'keystore',
    title: '6500 золота на аккаунт',
    description: 'По логину, без передачи пароля. Зачисление в день покупки.',
    priceRub: 1990,
  },
  {
    game: 'wot',
    category: 'service',
    seller: 'stabilno',
    title: 'Прокачка ветки до 10 уровня',
    description: 'Срок 7–10 дней, отчёт по этапам. Без использования модов.',
    priceRub: 5600,
  },
];

async function upsertGames() {
  for (const g of GAMES) {
    const game = await prisma.game.upsert({
      where: { slug: g.slug },
      update: { title: g.title, sortOrder: g.sortOrder },
      create: { slug: g.slug, title: g.title, sortOrder: g.sortOrder },
    });
    for (const c of g.categories) {
      await prisma.category.upsert({
        where: { gameId_slug: { gameId: game.id, slug: c.slug } },
        update: {},
        create: {
          gameId: game.id,
          slug: c.slug,
          title: c.title,
          segment: c.segment,
          fulfillmentType: c.fulfillmentType,
        },
      });
    }
  }
}

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
    if (!game) continue;
    const category = await prisma.category.findUnique({
      where: { gameId_slug: { gameId: game.id, slug: l.category } },
    });
    if (!category) continue;
    const seller = await prisma.user.findUnique({
      where: { email: `${l.seller}${DEMO_DOMAIN}` },
    });
    if (!seller) continue;

    const exists = await prisma.listing.findFirst({
      where: { sellerId: seller.id, title: l.title },
      select: { id: true },
    });
    if (exists) {
      if (category.fulfillmentType === FulfillmentType.auto_key) await refillDemoKeys(exists.id);
      continue;
    }

    const created = await prisma.listing.create({
      data: {
        sellerId: seller.id,
        gameId: game.id,
        categoryId: category.id,
        title: l.title,
        description: l.description,
        price: BigInt(Math.round(l.priceRub * 100)),
        currency: 'RUB',
        stock: l.stock ?? null,
        status: ListingStatus.active,
        fulfillmentType: category.fulfillmentType,
        autoDelivery: l.auto ?? false,
      },
    });
    if (category.fulfillmentType === FulfillmentType.auto_key) await refillDemoKeys(created.id);
  }
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
}

async function main() {
  await upsertGames();
  await upsertSellers();
  await upsertListings();
  const [games, listings] = await Promise.all([
    prisma.game.count(),
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
