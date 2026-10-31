/**
 * Сброс демо-стенда перед показом: снимает с продажи лоты, которые завели
 * во время прошлых показов (все продавцы не с демо-домена), и заново
 * выравнивает демо-витрину (`seed-demo.ts` — рейтинги в ноль, ключи на склад).
 *
 * Только для стенда. Ничего не удаляет: лоты уходят в `paused`, заказы
 * и деньги остаются в истории. На проде не запускать — снимет живые лоты.
 *
 * Запуск: `pnpm --filter @gamemarket/db demo:reset`
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_EMAIL_DOMAIN } from '../../shared/src/demo';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.DEMO_STAND !== '1') {
    throw new Error('demo:reset снимает с продажи лоты живых продавцов. На проде — только с DEMO_STAND=1.');
  }
  const res = await prisma.listing.updateMany({
    where: { status: 'active', seller: { email: { not: { endsWith: DEMO_EMAIL_DOMAIN } } } },
    data: { status: 'paused' },
  });
  console.log(`Снято с продажи лотов с прошлых показов: ${res.count}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
