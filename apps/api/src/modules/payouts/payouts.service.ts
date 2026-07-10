import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import {
  holdForPayout,
  reversePayoutHold,
  settlePayout,
  WITHDRAWAL_METHODS,
  getWithdrawalMethod,
  computeWithdrawalFee,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { LedgerService } from '../ledger/ledger.service';
import { EncryptionService } from '../crypto/encryption.service';
import { AuditService } from '../access/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

const NEWBIE_HOLD_DAYS = Number(process.env.PAYOUT_NEWBIE_HOLD_DAYS ?? 3);
// Вывод свыше порога — только после верификации личности (минорные единицы).
const KYC_REQUIRED_ABOVE = BigInt(process.env.PAYOUT_KYC_REQUIRED_ABOVE ?? 1_500_000);

@Injectable()
export class PayoutsService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Заявка на вывод: резерв суммы с баланса + холд для новичков (антифрод, docs/06). */
  async request(userId: string, amount: bigint, method: string, destination: string, currency = 'RUB') {
    if (amount <= 0n) throw new BadRequestException('Сумма должна быть положительной');

    const wm = getWithdrawalMethod(method);
    if (!wm) throw new BadRequestException('Неизвестный способ вывода');
    if (amount < wm.minAmount) {
      throw new BadRequestException(`Минимальная сумма вывода для «${wm.label}» — ${Number(wm.minAmount) / 100} ₽`);
    }
    if (amount > wm.maxAmount) {
      throw new BadRequestException(`Максимум для «${wm.label}» — ${Number(wm.maxAmount) / 100} ₽`);
    }

    const balance = await this.ledger.balanceOf(userId, currency);
    if (balance < amount) throw new BadRequestException('Недостаточно средств на балансе');

    // Крупный вывод — только после верификации личности (как на Playerok/PlayerAuctions).
    if (amount > KYC_REQUIRED_ABOVE) {
      const kyc = await this.prisma.kycVerification.findFirst({
        where: { userId, status: 'approved', level: 'document' },
        select: { id: true },
      });
      if (!kyc) {
        throw new BadRequestException(
          'Для вывода свыше 15 000 ₽ подтвердите личность в разделе «Верификация»',
        );
      }
    }

    const profile = await this.prisma.profile.findUnique({ where: { userId } });
    const holdDays = profile && profile.salesCount > 0 ? 0 : NEWBIE_HOLD_DAYS;
    const holdUntil = new Date(Date.now() + holdDays * 86400 * 1000);

    const payout = await this.prisma.payout.create({
      data: {
        userId,
        amount,
        currency,
        method,
        destinationEnc: this.encryption.encrypt(destination),
        status: 'requested',
        holdUntil,
      },
    });

    await this.ledger.post({
      legs: holdForPayout(userId, amount),
      currency,
      idempotencyKey: `payout_hold:${payout.id}`,
      refType: 'payout_hold',
      refId: payout.id,
    });

    return this.public(payout);
  }

  listMine(userId: string) {
    return this.prisma.payout
      .findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
      .then((rows) => rows.map((p) => this.public(p)));
  }

  list(status?: 'requested' | 'approved' | 'processing' | 'paid' | 'rejected') {
    return this.prisma.payout
      .findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'asc' } })
      .then((rows) => rows.map((p) => this.public(p)));
  }

  /** Одобрение выплаты (finance): проверка холда → отправка → баланс покидает площадку. */
  /** Способы вывода с комиссиями/лимитами (для UI и превью «на руки»). */
  listMethods() {
    return WITHDRAWAL_METHODS.map((m) => ({
      key: m.key,
      label: m.label,
      feePct: m.feePct,
      minFee: m.minFee.toString(),
      minAmount: m.minAmount.toString(),
      maxAmount: m.maxAmount.toString(),
    }));
  }

  async approve(payoutId: string, actorId: string) {
    const payout = await this.get(payoutId);
    if (payout.status !== 'requested') throw new ConflictException('Заявка уже обработана');
    if (payout.holdUntil && payout.holdUntil > new Date()) {
      throw new BadRequestException(`На холде до ${payout.holdUntil.toISOString()}`);
    }

    // Комиссия за вывод удерживается на выплате и идёт в доход площадки.
    const wm = getWithdrawalMethod(payout.method);
    const fee = wm ? computeWithdrawalFee(payout.amount, wm) : 0n;
    await this.ledger.post({
      legs: settlePayout(payout.amount, fee),
      currency: payout.currency,
      idempotencyKey: `payout_settle:${payout.id}`,
      refType: 'payout_settle',
      refId: payout.id,
    });
    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'paid', approvedBy: actorId },
    });
    await this.audit.log({ actorId, action: 'payout.approve', entityType: 'payout', entityId: payoutId });
    await this.notifications.notify(payout.userId, 'payout_paid', { payoutId, amount: payout.amount.toString() });
    return this.public(updated);
  }

  /** Отклонение (finance): возврат зарезервированного на баланс. */
  async reject(payoutId: string, actorId: string, reason?: string) {
    const payout = await this.get(payoutId);
    if (payout.status !== 'requested') throw new ConflictException('Заявка уже обработана');

    await this.ledger.post({
      legs: reversePayoutHold(payout.userId, payout.amount),
      currency: payout.currency,
      idempotencyKey: `payout_reverse:${payout.id}`,
      refType: 'payout_reverse',
      refId: payout.id,
    });
    const updated = await this.prisma.payout.update({
      where: { id: payoutId },
      data: { status: 'rejected', approvedBy: actorId },
    });
    await this.audit.log({
      actorId,
      action: 'payout.reject',
      entityType: 'payout',
      entityId: payoutId,
      after: { reason },
    });
    await this.notifications.notify(payout.userId, 'payout_rejected', { payoutId });
    return this.public(updated);
  }

  private async get(id: string) {
    const p = await this.prisma.payout.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Заявка на вывод не найдена');
    return p;
  }

  /** Без destinationEnc наружу. */
  private public(p: {
    id: string; amount: bigint; currency: string; method: string; status: string;
    holdUntil: Date | null; createdAt: Date;
  }) {
    return {
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      status: p.status,
      holdUntil: p.holdUntil,
      createdAt: p.createdAt,
    };
  }
}
