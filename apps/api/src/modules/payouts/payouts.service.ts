import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { z } from 'zod';
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
import { YooKassaPayouts, type GatewayPayout, type PayoutDestination } from './yookassa-payouts';

/** Первый вывод без продаж ждёт столько дней — защита от отмыва через пополнение. */
export const NEWBIE_HOLD_DAYS = Number(process.env.PAYOUT_NEWBIE_HOLD_DAYS ?? 3);
// Вывод свыше порога — только после верификации личности (минорные единицы).
export const KYC_REQUIRED_ABOVE = BigInt(process.env.PAYOUT_KYC_REQUIRED_ABOVE ?? 1_500_000);
/** Как часто сверять отправленные выплаты со шлюзом — на случай потерянного уведомления. */
const SWEEP_MS = Number(process.env.PAYOUT_SWEEP_INTERVAL_MS ?? 5 * 60_000);

// Уведомление ЮKassa о выплате: верим только id, статус и сумму перечитываем.
const notificationSchema = z.object({ event: z.string(), object: z.object({ id: z.string().min(1).max(64) }) });

type PayoutRow = { id: string; userId: string; amount: bigint; currency: string; method: string; status: string };

/** Карта из виджета ЮKassa: токен для выплаты и маска для показа. Номера нет. */
export interface CardToken {
  token: string;
  first6: string;
  last4: string;
  type?: string;
  issuer?: string;
}

/** Реквизиты-объект (СБП через шлюз, карта из виджета) или null — строка как есть. */
function parseJson(raw: string): Record<string, string | undefined> | null {
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, string | undefined>) : null;
  } catch {
    return null;
  }
}

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly ledger: LedgerService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly gateway: YooKassaPayouts,
  ) {}

  /**
   * Реквизиты для выплаты через шлюз: телефон СБП и банк из списка ЮKassa,
   * номер кошелька ЮMoney. Хранятся зашифрованными, как и раньше; для СБП —
   * JSON с телефоном и банком.
   */
  private async gatewayDestination(method: string, raw: string, bankId?: string): Promise<string> {
    if (method === 'sbp') {
      let phone = raw.replace(/\D/g, '');
      if (phone.length === 11 && phone.startsWith('8')) phone = `7${phone.slice(1)}`;
      if (phone.length === 10) phone = `7${phone}`;
      if (!/^7\d{10}$/.test(phone)) {
        throw new BadRequestException('Телефон для СБП — российский номер, например +7 900 000-00-00');
      }
      const banks = await this.gateway.sbpBanks();
      if (!bankId || !banks.some((b) => b.id === bankId)) {
        throw new BadRequestException('Выберите банк, в который придёт перевод по СБП');
      }
      return JSON.stringify({ phone, bankId });
    }
    const account = raw.replace(/\s/g, '');
    if (!/^\d{11,20}$/.test(account)) throw new BadRequestException('Номер кошелька ЮMoney — от 11 до 20 цифр');
    return account;
  }

  private destinationOf(method: string, enc: string): PayoutDestination | null {
    const raw = this.encryption.decrypt(enc);
    if (method === 'yoomoney') return /^\d{11,20}$/.test(raw) ? { method, account: raw } : null;
    const d = parseJson(raw);
    if (method === 'card') return d?.token ? { method, token: d.token } : null;
    if (method !== 'sbp') return null;
    return d?.phone && d.bankId ? { method, phone: d.phone, bankId: d.bankId } : null;
  }

  /** Карта из виджета ЮKassa: номера у площадки нет — вручную такую заявку не выплатить. */
  private gatewayOnly(p: { method: string; destinationEnc: string }) {
    return p.method === 'card' && this.destinationOf('card', p.destinationEnc) !== null;
  }

  /** Маска реквизитов: продавцу — куда уйдут деньги, сотруднику — какая это заявка. */
  private hint(method: string, enc: string | undefined): string | null {
    if (!enc) return null;
    let raw: string;
    try {
      raw = this.encryption.decrypt(enc);
    } catch {
      return null;
    }
    const d = parseJson(raw);
    if (d?.last4) return `•••• ${d.last4}`;
    if (d?.phone) raw = d.phone;
    if (method === 'usdt') return raw.length > 12 ? `${raw.slice(0, 4)}…${raw.slice(-4)}` : null;
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : null;
  }

  /** Заявка на вывод: резерв суммы с баланса + холд для новичков (антифрод, docs/06). */
  async request(
    userId: string,
    amount: bigint,
    method: string,
    destination: string | undefined,
    currency = 'RUB',
    details: { bankId?: string; card?: CardToken } = {},
  ) {
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
          `Вывод больше ${new Intl.NumberFormat('ru-RU').format(Number(KYC_REQUIRED_ABOVE / 100n))} ₽ — после проверки личности: «Безопасность» → «Проверка личности»`,
        );
      }
    }

    // Шлюз выплатит сам — реквизиты проверяем сразу, а не при одобрении.
    let stored: string;
    if (method === 'card' && this.gateway.handles('card')) {
      // Номер карты остаётся в ЮKassa: у нас — токен из её виджета и маска.
      if (!details.card) {
        throw new BadRequestException('Введите карту в форме ЮKassa: номер карты площадка не принимает');
      }
      const { token, first6, last4, type, issuer } = details.card;
      stored = JSON.stringify({ token, first6, last4, type, issuer });
    } else if (this.gateway.handles(method)) {
      stored = await this.gatewayDestination(method, destination ?? '', details.bankId);
    } else {
      stored = (destination ?? '').trim();
      if (stored.length < 4) throw new BadRequestException('Укажите реквизиты для вывода');
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
        destinationEnc: this.encryption.encrypt(stored),
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
      // Выплачивает шлюз сам — после одобрения, без ручного перевода.
      auto: this.gateway.handles(m.key),
      // Карта — через виджет ЮKassa: номер вводится в её форму.
      ...(m.key === 'card' && this.gateway.handles('card') ? { widget: this.gateway.cardWidget() } : {}),
    }));
  }

  /** Банки СБП для формы вывода; пусто — выплаты по СБП идут вручную. */
  sbpBanks() {
    return this.gateway.sbpBanks();
  }

  /** Сумма «на руки»: заявка минус комиссия вывода площадки. */
  private net(p: { amount: bigint; method: string }) {
    const wm = getWithdrawalMethod(p.method);
    return p.amount - (wm ? computeWithdrawalFee(p.amount, wm) : 0n);
  }

  async approve(payoutId: string, actorId: string) {
    const payout = await this.get(payoutId);
    if (payout.status !== 'requested') throw new ConflictException('Заявка уже обработана');
    if (payout.holdUntil && payout.holdUntil > new Date()) {
      throw new BadRequestException(`На холде до ${payout.holdUntil.toISOString()}`);
    }
    if (this.gateway.handles(payout.method)) return this.send(payout, actorId);
    if (this.gatewayOnly(payout)) {
      throw new BadRequestException('Карта сохранена в ЮKassa — эту заявку выплачивает только она. Включите выплаты через ЮKassa или отклоните заявку');
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

  /**
   * Выплата через шлюз. Заявка сначала занимается (requested → approved):
   * два одновременных одобрения не отправят деньги дважды, а повтор после
   * обрыва связи уходит с тем же ключом идемпотентности. «Выплачено» —
   * только когда шлюз подтвердит: до этого заявка «отправляется», а деньги
   * в резерве.
   */
  private async send(payout: PayoutRow & { destinationEnc: string }, actorId: string) {
    const claimed = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: 'requested' },
      data: { status: 'approved', approvedBy: actorId },
    });
    if (!claimed.count) throw new ConflictException('Заявка уже обработана');
    const release = () =>
      this.prisma.payout.updateMany({ where: { id: payout.id, status: 'approved' }, data: { status: 'requested' } });

    const destination = this.destinationOf(payout.method, payout.destinationEnc);
    if (!destination) {
      await release();
      throw new BadRequestException('Реквизиты заявки не подходят для автоматической выплаты — отклоните её');
    }
    let sent: GatewayPayout;
    try {
      sent = await this.gateway.create({
        payoutId: payout.id,
        amount: this.net(payout),
        currency: payout.currency,
        destination,
      });
    } catch (e) {
      await release();
      throw e;
    }
    const updated = await this.prisma.payout.update({
      where: { id: payout.id },
      data: { status: 'processing', externalId: sent.id },
    });
    await this.audit.log({ actorId, action: 'payout.send', entityType: 'payout', entityId: payout.id, after: { externalId: sent.id } });
    if (sent.status !== 'pending') await this.settleFromGateway(sent);
    return this.public(sent.status === 'pending' ? updated : await this.get(payout.id));
  }

  /** Шлюз выплатил: резерв покидает площадку, комиссия — в доход. Повтор — без последствий. */
  private async complete(payout: PayoutRow) {
    const wm = getWithdrawalMethod(payout.method);
    const fee = wm ? computeWithdrawalFee(payout.amount, wm) : 0n;
    await this.ledger.post({
      legs: settlePayout(payout.amount, fee),
      currency: payout.currency,
      idempotencyKey: `payout_settle:${payout.id}`,
      refType: 'payout_settle',
      refId: payout.id,
    });
    const done = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: { in: ['approved', 'processing'] } },
      data: { status: 'paid' },
    });
    if (done.count) {
      await this.notifications.notify(payout.userId, 'payout_paid', { payoutId: payout.id, amount: payout.amount.toString() });
    }
  }

  /** Шлюз не выплатил: резерв — обратно на баланс, причина — в заявку. */
  private async fail(payout: PayoutRow, reason: string | null) {
    await this.ledger.post({
      legs: reversePayoutHold(payout.userId, payout.amount),
      currency: payout.currency,
      idempotencyKey: `payout_reverse:${payout.id}`,
      refType: 'payout_reverse',
      refId: payout.id,
    });
    const done = await this.prisma.payout.updateMany({
      where: { id: payout.id, status: { in: ['approved', 'processing'] } },
      data: { status: 'rejected', failureReason: reason ?? 'canceled' },
    });
    if (done.count) await this.notifications.notify(payout.userId, 'payout_rejected', { payoutId: payout.id });
  }

  /** Итог выплаты у шлюза — в заявку, со сверкой суммы. */
  private async settleFromGateway(g: GatewayPayout): Promise<'paid' | 'failed' | 'pending' | 'unknown'> {
    const payout =
      (await this.prisma.payout.findFirst({ where: { externalId: g.id } })) ??
      (g.payoutId ? await this.prisma.payout.findFirst({ where: { id: g.payoutId, status: 'approved' } }) : null);
    if (!payout) return 'unknown';
    if (g.status === 'pending') return 'pending';
    if (g.status === 'succeeded') {
      if (g.amount !== this.net(payout) || g.currency !== payout.currency) {
        this.logger.error(`Выплата ${payout.id}: шлюз сообщил ${g.amount} ${g.currency}, ожидалось ${this.net(payout)}`);
        throw new BadRequestException('Сумма выплаты не совпадает с заявкой');
      }
      await this.complete(payout);
      return 'paid';
    }
    await this.fail(payout, g.reason);
    return 'failed';
  }

  /**
   * Уведомление ЮKassa о выплате. Не подписано, адрес публичный — поэтому
   * статус и сумму перечитываем в API ЮKassa с ключом агента выплат.
   */
  async webhook(body: unknown) {
    if (!this.gateway.enabled) throw new NotFoundException();
    const note = notificationSchema.safeParse(body);
    if (!note.success) throw new UnauthorizedException('Невалидная подпись вебхука');
    if (note.data.event !== 'payout.succeeded' && note.data.event !== 'payout.canceled') return { ok: true, ignored: true };
    const g = await this.gateway.fetch(note.data.object.id);
    if (!g) throw new UnauthorizedException('Невалидная подпись вебхука');
    const result = await this.settleFromGateway(g);
    if (result === 'unknown') throw new UnauthorizedException('Невалидная подпись вебхука');
    return { ok: true, status: result };
  }

  /** Сверка «отправляется» со шлюзом: уведомление могло потеряться. */
  @Interval('payouts-sweep', SWEEP_MS)
  async sweep() {
    if (!this.gateway.enabled) return;
    const stale = await this.prisma.payout.findMany({
      where: { status: 'processing', externalId: { not: null }, updatedAt: { lt: new Date(Date.now() - 60_000) } },
      take: 50,
    });
    for (const p of stale) {
      try {
        const g = await this.gateway.fetch(p.externalId!);
        if (g) await this.settleFromGateway(g);
      } catch (e) {
        this.logger.warn(`Сверка выплаты ${p.id}: ${(e as Error).message}`);
      }
    }
  }

  /**
   * Реквизиты для ручной выплаты — сотруднику финансов, с записью в журнал:
   * без них переводить было некуда. Выплаты через ЮKassa раскрывать незачем —
   * получатель у неё, а сотруднику хватает маски.
   */
  async reveal(payoutId: string, actorId: string) {
    const payout = await this.get(payoutId);
    if (this.gateway.handles(payout.method) || this.gatewayOnly(payout)) {
      throw new BadRequestException('Эту выплату отправляет ЮKassa — реквизиты у неё');
    }
    const raw = this.encryption.decrypt(payout.destinationEnc);
    const d = parseJson(raw);
    await this.audit.log({ actorId, action: 'payout.reveal', entityType: 'payout', entityId: payoutId });
    return {
      id: payout.id,
      method: payout.method,
      // СБП, принятая при включённом шлюзе, хранится объектом.
      destination: d?.phone ? `+${d.phone}${d.bankId ? ` · банк ${d.bankId}` : ''}` : raw,
    };
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

  /** Без destinationEnc наружу — только маска. */
  private public(p: {
    id: string; amount: bigint; currency: string; method: string; status: string;
    holdUntil: Date | null; createdAt: Date; externalId?: string | null; failureReason?: string | null;
    destinationEnc?: string;
  }) {
    return {
      id: p.id,
      amount: p.amount,
      currency: p.currency,
      method: p.method,
      status: p.status,
      holdUntil: p.holdUntil,
      createdAt: p.createdAt,
      // Выплата через шлюз: номер у шлюза и причина отказа — для сверки.
      externalId: p.externalId ?? null,
      failureReason: p.failureReason ?? null,
      destinationHint: this.hint(p.method, p.destinationEnc),
    };
  }
}
