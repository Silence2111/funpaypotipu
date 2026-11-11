import { Inject, Injectable } from '@nestjs/common';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

type Tx = Prisma.TransactionClient;

/**
 * Бонусы покупателя (часть 146). В «Безопасной сделке» кэшбэк деньгами не
 * платим: выплата 20 ₽ на карту дороже самих 20 ₽, а баланс площадки в
 * сделке не потратить. Вместо него — бонусы: начисляются, когда деньги ушли
 * продавцу, и списываются скидкой при следующей оплате — из вознаграждения
 * площадки, выплату продавца не трогают. Не деньги: не выводятся.
 *
 * Баланс — сумма записей. Возврат бонусов при отмене заказа делает триггер
 * базы (`order_bonus_refund`): путей к отмене много, ни один не забыт.
 */
@Injectable()
export class BonusesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async balance(userId: string, tx: Tx | PrismaClient = this.prisma): Promise<bigint> {
    const r = await tx.bonusEntry.aggregate({ where: { userId }, _sum: { amount: true } });
    const v = r._sum.amount ?? 0n;
    return v > 0n ? v : 0n;
  }

  /** Баланс и последние записи — для кошелька. */
  async summary(userId: string) {
    const [balance, entries] = await Promise.all([
      this.balance(userId),
      this.prisma.bonusEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, amount: true, kind: true, orderId: true, createdAt: true },
      }),
    ]);
    return {
      balance: balance.toString(),
      entries: entries.map((e) => ({ ...e, amount: e.amount.toString() })),
    };
  }

  /**
   * Сколько бонусов спишется в заказе — в транзакции создания заказа, под
   * блокировкой покупателя: два заказа разом не потратят одни бонусы дважды.
   */
  async take(tx: Tx, userId: string, cap: bigint): Promise<bigint> {
    if (cap <= 0n) return 0n;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`bonus:${userId}`}))`;
    const have = await this.balance(userId, tx);
    return have < cap ? have : cap;
  }

  /** Записать списание по созданному заказу. */
  async spend(tx: Tx, userId: string, orderId: string, amount: bigint) {
    if (amount <= 0n) return;
    await tx.bonusEntry.create({ data: { userId, orderId, amount: -amount, kind: 'spend' } });
  }

  /** Начисление за заказ; повтор по тому же заказу ничего не добавит. */
  async accrue(userId: string, orderId: string, amount: bigint): Promise<boolean> {
    if (amount <= 0n) return false;
    const r = await this.prisma.bonusEntry.createMany({
      data: [{ userId, orderId, amount, kind: 'accrual' }],
      skipDuplicates: true,
    });
    return r.count > 0;
  }
}
