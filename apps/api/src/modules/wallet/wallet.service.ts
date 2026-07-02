import { Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class WalletService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
  ) {}

  async getWallet(userId: string, currency = 'RUB') {
    const balance = await this.ledger.balanceOf(userId, currency);
    return { currency, balance }; // balance сериализуется строкой (BigInt.toJSON)
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
