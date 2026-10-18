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
  /** Пополнение на сумму покупателя: цена лота считается из условий («от»). */
  topup?: { markupBps: number; minRub: number; maxRub: number };
  /** Поштучно: priceRub — цена за perUnits единиц, покупатель выбирает количество. */
  qty?: { unit: string; perUnits: number; minQty: number; stock: number };
  /** Прежнее название лота: стенды, поднятые до смены, получают его обновлённым. */
  legacyTitle?: string;
  /** Параметры раздела (звание, регион) — колонки таблицы раздела. */
  attributes?: Record<string, string | boolean>;
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
    attributes: { rank: 'Gold Nova', region: 'CIS', prime: true, delivery: 'Со сменой почты' },
  },
  {
    game: 'cs2',
    category: 'skins',
    seller: 'stabilno',
    title: 'AK-47 Redline, Field-Tested',
    description: 'Обмен через Steam после подтверждения сделки. Трейд-бан снят.',
    priceRub: 1190,
    attributes: { rarity: 'Classified' },
  },
  {
    game: 'cs2',
    category: 'keys',
    seller: 'keystore',
    title: 'Ключ от кейса Dreams & Nightmares',
    description: 'Выдача сразу после оплаты, из склада. Ключ не активирован.',
    priceRub: 219,
    auto: true,
    attributes: { region: 'Global', platform: 'Steam' },
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
    title: 'Пополнение кошелька Steam',
    description:
      'Любая сумма от 100 до 15 000 ₽. Нужен только логин Steam, пароль не нужен. ' +
      'Зачисление за несколько минут после оплаты.',
    priceRub: 0, // считается из условий: цена 100 ₽ с наценкой
    auto: true,
    topup: { markupBps: 800, minRub: 100, maxRub: 15_000 },
    legacyTitle: 'Пополнение кошелька Steam, 1000 ₽',
  },
  {
    game: 'steam',
    category: 'keys',
    seller: 'keystore',
    title: 'Ключ Baldur’s Gate 3, регион РФ',
    description: 'Активация в Steam. Выдача автоматическая после оплаты.',
    priceRub: 2790,
    auto: true,
    attributes: { region: 'Россия' },
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
    attributes: { server: 'Europe' },
  },
  {
    game: 'roblox',
    category: 'currency',
    seller: 'keystore',
    title: 'Robux через геймпасс, от 400',
    legacyTitle: '1000 Robux на аккаунт',
    description: 'Через геймпасс. Нужен ник и открытая группа. Количество выбираете сами, от 400 Robux.',
    priceRub: 69,
    qty: { unit: 'Robux', perUnits: 100, minQty: 400, stock: 200_000 },
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
    title: 'Золото на аккаунт, от 2 500',
    legacyTitle: '6500 золота на аккаунт',
    description:
      'По логину, без передачи пароля. Количество выбираете сами, от 2 500 золота. ' +
      'Зачисление в день покупки.',
    priceRub: 310,
    qty: { unit: 'золота', perUnits: 1000, minQty: 2500, stock: 5_000_000 },
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
