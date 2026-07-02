import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { assertBalanced, balanceDelta, type AccountRef, type PostingLeg } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

type Tx = Prisma.TransactionClient;

export interface PostInput {
  legs: PostingLeg[];
  currency: string;
  idempotencyKey: string;
  orderId?: string;
  refType?: string;
  refId?: string;
}

/**
 * Двойная бухгалтерия. Все проводки — append-only, атомарны и идемпотентны.
 * Балансы счетов денормализованы (кредит-положительные), см. docs/03.
 */
@Injectable()
export class LedgerService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Провести сбалансированный набор. Повтор с тем же ключом — no-op. */
  async post(input: PostInput): Promise<void> {
    assertBalanced(input.legs);
    await this.prisma.$transaction(async (tx) => {
      const dup = await tx.ledgerEntry.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (dup) return; // уже проведено

      const txnId = randomUUID();
      for (let i = 0; i < input.legs.length; i++) {
        const leg = input.legs[i];
        const account = await this.getOrCreateAccount(tx, leg.account, input.currency);
        await tx.ledgerEntry.create({
          data: {
            txnId,
            accountId: account.id,
            direction: leg.direction,
            amount: leg.amount,
            currency: input.currency,
            orderId: input.orderId,
            refType: input.refType,
            refId: input.refId,
            // ключ идемпотентности несёт только первая нога набора (поле уникально)
            idempotencyKey: i === 0 ? input.idempotencyKey : null,
          },
        });
        await tx.ledgerAccount.update({
          where: { id: account.id },
          data: { balance: { increment: balanceDelta(leg) } },
        });
      }
    });
  }

  async balanceOf(userId: string, currency: string): Promise<bigint> {
    const acc = await this.prisma.ledgerAccount.findFirst({
      where: { ownerType: 'user', ownerId: userId, kind: 'available', currency },
    });
    return acc?.balance ?? 0n;
  }

  private async getOrCreateAccount(tx: Tx, ref: AccountRef, currency: string) {
    const ownerId = ref.ownerType === 'user' ? ref.ownerId : null;
    const existing = await tx.ledgerAccount.findFirst({
      where: { ownerType: ref.ownerType, ownerId, kind: ref.kind, currency },
    });
    if (existing) return existing;
    return tx.ledgerAccount.create({
      data: { ownerType: ref.ownerType, ownerId, kind: ref.kind, currency },
    });
  }
}
