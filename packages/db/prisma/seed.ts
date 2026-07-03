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
  await seedFees();
  console.log('✅ Seed завершён');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
