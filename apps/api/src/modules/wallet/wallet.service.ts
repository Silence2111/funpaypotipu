import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';

/** Заявка ещё в пути: деньги уже не на балансе, но и не у продавца. */
const PAYOUT_PENDING = ['requested', 'approved', 'processing'] as const;
/** Продажа оплачена, но покупатель ещё не подтвердил получение. */
const DEAL_OPEN = ['paid', 'delivered'] as const;

@Injectable()
export class WalletService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Баланс и деньги в пути: «в сделках» — оплаченные продажи до
   * подтверждения покупателем (зачислятся потом), «на выводе» — заявки,
   * которые ещё не выплачены. Суммы — строками (BigInt.toJSON).
   */
  async getWallet(userId: string, currency = 'RUB') {
    const [balance, deals, payouts, dealPayouts, waiting] = await Promise.all([
      this.ledger.balanceOf(userId, currency),
      this.prisma.order.aggregate({
        where: {
          sellerId: userId,
          currency,
          OR: [
            { status: { in: [...DEAL_OPEN] } },
            // Подтверждён, но идёт гарантия продавца (часть 126): деньги ещё у площадки.
            { status: 'completed', warrantyUntil: { not: null }, warrantyReleasedAt: null },
          ],
        },
        _count: { _all: true },
        _sum: { sellerPayoutAmount: true },
      }),
      this.prisma.payout.aggregate({
        where: { userId, currency, status: { in: [...PAYOUT_PENDING] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      // «Безопасная сделка» (часть 123): выплаты по сделкам, которые ещё не дошли.
      this.prisma.dealPayout.aggregate({
        where: { sellerId: userId, currency, status: { in: ['waiting', 'sent', 'failed'] } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      this.prisma.dealPayout.count({ where: { sellerId: userId, currency, status: { in: ['waiting', 'failed'] } } }),
    ]);
    return {
      currency,
      balance,
      inDeals: { count: deals._count._all, amount: deals._sum.sellerPayoutAmount ?? 0n },
      withdrawing: { count: payouts._count._all, amount: payouts._sum.amount ?? 0n },
      // waiting — сколько из них ждут карту или ЮMoney (или новые реквизиты после отказа).
      dealPayouts: { count: dealPayouts._count._all, amount: dealPayouts._sum.amount ?? 0n, waiting },
    };
  }

  async transactions(userId: string, limit = 50) {
    const accounts = await this.prisma.ledgerAccount.findMany({
      where: { ownerType: 'user', ownerId: userId },
      select: { id: true },
    });
    const ids = accounts.map((a) => a.id);
    if (ids.length === 0) return [];

    return this.prisma.ledgerEntry.findMany({
      where: { accountId: { in: ids } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        direction: true,
        amount: true,
        currency: true,
        orderId: true,
        refType: true,
        createdAt: true,
      },
    });
  }
}
