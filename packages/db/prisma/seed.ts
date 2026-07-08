/**
 * Сид демо-данных: роли/права, базовые игры и категории, дефолтная комиссия.
 * Запуск: pnpm --filter @gamemarket/db seed
 */
import { PrismaClient, CategorySegment, FulfillmentType, FeeScope } from '@prisma/client';

const prisma = new PrismaClient();

const ROLES: Record<string, string[]> = {
  buyer: ['order.create', 'review.create'],
  seller: ['listing.manage', 'order.fulfill', 'payout.request'],
  agent: ['dispute.handle'],
  moderator: ['listing.moderate', 'user.moderate'],
  finance: ['payout.approve', 'refund.issue'],
  admin: ['*'],
};

async function seedRbac() {
  const allPerms = [...new Set(Object.values(ROLES).flat())];
  for (const key of allPerms) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const [roleKey, perms] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { key: roleKey },
      update: {},
      create: { key: roleKey },
    });
    for (const permKey of perms) {
      const perm = await prisma.permission.findUnique({ where: { key: permKey } });
      if (!perm) continue;
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } },
        update: {},
        create: { roleId: role.id, permissionId: perm.id },
      });
    }
  }
}

async function seedCatalog() {
  const cs2 = await prisma.game.upsert({
    where: { slug: 'cs2' },
    update: {},
    create: { slug: 'cs2', title: 'Counter-Strike 2', sortOrder: 1 },
  });
  await prisma.category.upsert({
    where: { gameId_slug: { gameId: cs2.id, slug: 'accounts' } },
    update: {},
    create: {
      gameId: cs2.id,
      slug: 'accounts',
      title: 'Аккаунты',
      segment: CategorySegment.accounts,
      fulfillmentType: FulfillmentType.manual,
    },
  });
  await prisma.category.upsert({
    where: { gameId_slug: { gameId: cs2.id, slug: 'skins' } },
    update: {},
    create: {
      gameId: cs2.id,
      slug: 'skins',
      title: 'Скины и предметы',
      segment: CategorySegment.items,
      fulfillmentType: FulfillmentType.manual,
    },
  });
  await prisma.category.upsert({
    where: { gameId_slug: { gameId: cs2.id, slug: 'keys' } },
    update: {},
    create: {
      gameId: cs2.id,
      slug: 'keys',
      title: 'Ключи (авто-выдача)',
      segment: CategorySegment.key,
      fulfillmentType: FulfillmentType.auto_key,
    },
  });
}

async function seedAttributes() {
  const cs2 = await prisma.game.findUnique({ where: { slug: 'cs2' } });
  if (!cs2) return;
  const bySlug = async (slug: string) =>
    prisma.category.findUnique({ where: { gameId_slug: { gameId: cs2.id, slug } } });

  const specs: Record<string, Array<{ key: string; label: string; type: string; options?: string[]; isRequired?: boolean; sortOrder: number }>> = {
    accounts: [
      { key: 'rank', label: 'Звание', type: 'enum', isRequired: true, sortOrder: 1,
        options: ['Silver', 'Gold Nova', 'Master Guardian', 'Legendary Eagle', 'Supreme', 'Global Elite'] },
      { key: 'region', label: 'Регион', type: 'enum', isRequired: true, sortOrder: 2,
        options: ['EU', 'CIS', 'NA', 'Asia'] },
      { key: 'prime', label: 'Prime-статус', type: 'bool', sortOrder: 3 },
    ],
    skins: [
      { key: 'rarity', label: 'Редкость', type: 'enum', isRequired: true, sortOrder: 1,
        options: ['Consumer', 'Industrial', 'Mil-Spec', 'Restricted', 'Classified', 'Covert', 'Нож/Перчатки'] },
      { key: 'stattrak', label: 'StatTrak™', type: 'bool', sortOrder: 2 },
    ],
    keys: [
      { key: 'region', label: 'Регион', type: 'enum', isRequired: true, sortOrder: 1,
        options: ['Global', 'EU', 'CIS', 'NA'] },
      { key: 'platform', label: 'Платформа', type: 'enum', sortOrder: 2,
        options: ['Steam', 'Epic', 'Origin'] },
    ],
  };

  for (const [slug, attrs] of Object.entries(specs)) {
    const cat = await bySlug(slug);
    if (!cat) continue;
    for (const a of attrs) {
      await prisma.attribute.upsert({
        where: { categoryId_key: { categoryId: cat.id, key: a.key } },
        update: { label: a.label, type: a.type, options: a.options ?? undefined, isRequired: a.isRequired ?? false, sortOrder: a.sortOrder },
        create: {
          categoryId: cat.id,
          key: a.key,
          label: a.label,
          type: a.type,
          options: a.options ?? undefined,
          isFilter: true,
          isRequired: a.isRequired ?? false,
          sortOrder: a.sortOrder,
        },
      });
    }
  }
}

async function seedFees() {
  const existing = await prisma.feeRule.findFirst({ where: { scope: FeeScope.global } });
  if (!existing) {
    await prisma.feeRule.create({
      data: {
        scope: FeeScope.global,
        feeBuyerPct: 0,
        feeSellerPct: 0.1, // 10% с продавца по умолчанию
        currency: 'RUB',
        priority: 0,
      },
    });
  }
}

async function main() {
  await seedRbac();
  await seedCatalog();
  await seedAttributes();
  await seedFees();
  console.log('✅ Seed завершён');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
