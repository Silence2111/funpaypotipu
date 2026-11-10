/**
 * Базовый сид: роли и права, справочник игр и разделов (`catalog.ts`),
 * комиссия по умолчанию.
 * Запуск: pnpm --filter @gamemarket/db seed
 */
import { PrismaClient, FeeScope } from '@prisma/client';
import { seedCatalog } from './catalog';

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

async function seedFees() {
  const existing = await prisma.feeRule.findFirst({ where: { scope: FeeScope.global } });
  if (!existing) {
    await prisma.feeRule.create({
      data: {
        scope: FeeScope.global,
        feeBuyerPct: 0,
        feeSellerPct: 0.1, // 10% по умолчанию — уже дешевле 20% у конкурентов
        currency: 'RUB',
        priority: 0,
      },
    });
  }

  // Дифференцированная комиссия по категориям (как 10%/20% у Playerok):
  // цифровые ключи/лицензии дешевле — 10%.
  const cs2 = await prisma.game.findUnique({ where: { slug: 'cs2' } });
  if (cs2) {
    const keys = await prisma.category.findUnique({
      where: { gameId_slug: { gameId: cs2.id, slug: 'keys' } },
    });
    if (keys) {
      const has = await prisma.feeRule.findFirst({
        where: { scope: FeeScope.category, scopeRef: keys.id, currency: 'RUB' },
      });
      if (!has) {
        await prisma.feeRule.create({
          data: {
            scope: FeeScope.category,
            scopeRef: keys.id,
            feeBuyerPct: 0,
            feeSellerPct: 0.07, // 7% на ключи/лицензии (ещё дешевле)
            currency: 'RUB',
            priority: 10,
          },
        });
      }
    }
  }
}

async function main() {
  await seedRbac();
  await seedCatalog(prisma);
  await seedFees();
  console.log('✅ Seed завершён');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
