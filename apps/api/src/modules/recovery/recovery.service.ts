import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AccountRecovery, Prisma, PrismaClient } from '@gamemarket/db';
import { deviceOf } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { TokenService } from '../auth/token.service';
import { NOT_ME_RESET_TTL, passwordStamp, type RequestCtx } from '../auth/auth.service';
import { SAFE_KEY, StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';
import { MailService } from '../mail/mail.service';
import { EncryptionService } from '../crypto/encryption.service';
import { CARD_CHECK_PURPOSE, YooKassaProvider } from '../payments/yookassa.provider';
import type { CardPrint } from '../payments/payment.provider';
import { langOf, say } from '../../i18n/texts';

/**
 * Решение по заявке — не раньше чем через 3 дня. Если заявку подал не
 * владелец, а владелец ещё в аккаунте, он успеет отметить «Заявку подал не я».
 */
export const RECOVERY_WAIT_MS = 72 * 3_600_000;
export const RECOVERY_REASONS = ['two_factor', 'password', 'other'] as const;
export type RecoveryReason = (typeof RECOVERY_REASONS)[number];
export type RecoveryStatus = 'pending' | 'restored' | 'rejected';

/** Ссылка «Загрузите документы» на новую почту живёт неделю. */
export const RECOVERY_DOCS_TTL = 7 * 86_400;

/**
 * Без проверки личности — подтверждения хотя бы двух разных участников
 * сделок: одного мошенник может уговорить или завести сам.
 */
export const RECOVERY_DEALS_NEEDED = 2;
export const DEAL_ANSWERS = ['match', 'mismatch', 'unsure'] as const;
export type DealAnswer = (typeof DEAL_ANSWERS)[number];
type LinkPurpose = 'recovery_docs' | 'recovery_deals' | 'recovery_card';

/** Проверка картой: на карте блокируется 1 ₽, потом блокировка отменяется. */
export const CARD_CHECK_AMOUNT = 100n;
/**
 * Карта засчитывается, если ею платили в аккаунте (или на неё выводили) не
 * позже чем за 2 недели до заявки: свежую карту мог завести и чужой, пока
 * сидел в аккаунте.
 */
export const CARD_MIN_AGE_MS = 14 * 86_400_000;
const CARD_METHODS = ['card', 'applepay', 'googlepay'];

/** Итог сверки карты проверочного платежа с картами аккаунта. */
interface CardResult extends CardPrint {
  matched: boolean;
  /** Когда карта впервые появилась в аккаунте — оплатой или выплатой. */
  firstUsedAt: string | null;
  source: 'payment' | 'payout' | null;
}

/** Документ и селфи — фото или PDF скана, как у проверки личности. */
const DOC_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
};

interface Refs {
  keys?: string[];
  selfie?: string;
}

/** «n***@mail.ru»: старой почте — куда сменили, но не весь адрес. */
const maskEmail = (email: string) => {
  const [name, domain] = email.split('@');
  return `${name?.slice(0, 1) ?? ''}***@${domain ?? ''}`;
};

/** Завершённые до заявки сделки двух пользователей — в любую сторону. */
const between = (a: string, b: string, before: Date) => ({
  status: 'completed' as const,
  completedAt: { lt: before },
  OR: [
    { buyerId: a, sellerId: b },
    { buyerId: b, sellerId: a },
  ],
});

interface DealRow {
  counterpartyId: string | null;
  answer: string | null;
  answerIp: string | null;
}

/** Ответ с IP заявки или описаний — похоже, отвечает сам заявитель: не считается. */
const sameIp = (rec: { ip: string | null; dealsIp: string | null }, d: DealRow) =>
  !!d.answerIp && (d.answerIp === rec.ip || d.answerIp === rec.dealsIp);

/** Сколько разных участников сделок подтвердили описание. */
export const confirmedDeals = (
  rec: { ip: string | null; dealsIp: string | null },
  deals: DealRow[],
) =>
  new Set(
    deals
      .filter((d) => d.counterpartyId && d.answer === 'match' && !sameIp(rec, d))
      .map((d) => d.counterpartyId),
  ).size;

/** Почему проверка картой не доказывает, что аккаунт заявителя, или null — доказывает. */
function cardBlocker(rec: AccountRecovery) {
  if (!rec.cardCheckedAt) return 'Проверочного платежа картой ещё не было';
  const r = rec.cardResult as CardResult | null;
  if (!r?.matched || !r.firstUsedAt) return 'Карта не совпала с оплатами и выплатами аккаунта';
  if (new Date(r.firstUsedAt).getTime() > rec.createdAt.getTime() - CARD_MIN_AGE_MS) {
    return 'Карта впервые появилась в аккаунте меньше чем за 2 недели до заявки';
  }
  return null;
}

/**
 * Почему нельзя восстановить на новую почту, или null — можно. Один источник
 * для консоли и для самого восстановления. Доказательства:
 * - карта, которой платили в аккаунте, — проверочным платежом; её
 *   подтверждает держатель карты, поэтому она годится и без проверки
 *   личности, и при возражении из аккаунта;
 * - с проверкой личности — документы;
 * - без неё — сделки, и тогда возражение из аккаунта или «не совпадает» от
 *   участника сделки останавливают: при сомнении аккаунт лучше не отдать,
 *   чем отдать чужому.
 */
export function newEmailBlocker(rec: AccountRecovery, hasKyc: boolean, deals: DealRow[]) {
  if (!rec.contactEmail) return 'В заявке нет новой почты';
  const card = rec.cardRequestedAt ? cardBlocker(rec) : undefined;
  if (card === null) return null;
  const main = hasKyc
    ? rec.evidenceAt
      ? null
      : 'Документы по ссылке ещё не присланы'
    : dealsBlocker(rec, deals);
  if (main === null) return null;
  // Причина — от того пути, которым идёт заявка: просили только карту — про карту.
  const mainStarted = hasKyc ? !!rec.evidenceRequestedAt : !!rec.dealsRequestedAt;
  return card !== undefined && !mainStarted ? card : main;
}

/** Почему сделки не доказывают, что аккаунт заявителя, или null — доказывают. */
function dealsBlocker(rec: AccountRecovery, deals: DealRow[]) {
  if (rec.objectedAt) {
    return 'Из аккаунта отметили «Заявку подал не я» — по сделкам на новую почту не восстановить';
  }
  if (!rec.dealsAt) return 'Описания сделок по ссылке ещё не присланы';
  if (deals.some((d) => d.answer === 'mismatch')) {
    return 'Участник сделки ответил, что описание не совпадает';
  }
  if (confirmedDeals(rec, deals) < RECOVERY_DEALS_NEEDED) {
    return 'Нужны подтверждения хотя бы двух разных участников сделок';
  }
  return null;
}

/** Номер заказа — без учёта регистра: в номере есть строчные буквы, а вводят как угодно. */
const byNumber = (numbers: string[]) =>
  numbers.map((n) => ({ publicNumber: { equals: n, mode: 'insensitive' as const } }));

const SECURITY_TYPES = [
  'new_login',
  'password_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'recovery_requested',
];

/**
 * «Не могу войти»: восстановление доступа через сотрудника, когда «Это не я»
 * из писем не помогло — например, чужой сменил пароль, а потом включил вход
 * с кодом. Такой путь — излюбленный у мошенников, поэтому:
 * - ответ на заявку всегда один: по нему не узнать, есть ли аккаунт;
 * - владельцу аккаунта приходит уведомление, и он может отметить «Заявку
 *   подал не я» — это не отмена (в аккаунте может сидеть и чужой), а знак
 *   сотруднику;
 * - решить можно не раньше чем через 3 дня;
 * - сотрудник видит, какие номера заказов из заявки у этого аккаунта, и
 *   историю входов, смен пароля и входа с кодом;
 * - восстановление сбрасывает всё, чем мог завладеть чужой, а ссылка задать
 *   пароль уходит только на почту аккаунта.
 *
 * Нет доступа и к почте — заявка с новой почтой. Привязать её можно только
 * аккаунту с пройденной проверкой личности: сотрудник просит документы
 * ссылкой на новую почту (так видно, что почта — заявителя), сверяет селфи
 * с документом с одобренными раньше и только тогда восстанавливает доступ
 * на новую почту. Старой почте — письмо, что её сменили.
 *
 * Проверки личности нет — заявитель по такой же ссылке описывает до трёх
 * сделок, а другая сторона каждой из них в своём кабинете отвечает,
 * совпадает ли описание. Нужны подтверждения двух разных участников, не с
 * IP заявителя, без «не совпадает» и без возражения из аккаунта.
 *
 * Если в аккаунте платили картой или выводили на неё — проверка картой:
 * по ссылке заявитель блокирует 1 ₽ через ЮKassa, карта (первые 6 и
 * последние 4 цифры) сверяется с прошлыми, блокировка отменяется.
 */
@Injectable()
export class RecoveryService {
  private readonly logger = new Logger(RecoveryService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly scanner: ScanService,
    private readonly mail: MailService,
    private readonly yookassa: YooKassaProvider,
    private readonly encryption: EncryptionService,
  ) {}

  /** Заявка без входа. Ответ всегда один — есть аккаунт или нет. */
  async request(
    input: {
      email: string;
      reason: RecoveryReason;
      orderNumbers: string[];
      details: string;
      newEmail?: string;
    },
    ctx: RequestCtx,
  ) {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: input.email.trim(), mode: 'insensitive' } },
      select: { id: true, email: true },
    });
    if (!user) return { ok: true };
    // Одна заявка в ожидании: повтор не плодит очередь и уведомления.
    const pending = await this.prisma.accountRecovery.findFirst({
      where: { userId: user.id, status: 'pending' },
      select: { id: true },
    });
    if (pending) return { ok: true };
    // Без пробелов и повторов; регистр — как ввели: заказы сверяются без учёта регистра.
    const orderNumbers = input.orderNumbers
      .map((n) => n.trim())
      .filter((n, k, all) => n && all.findIndex((m) => m.toLowerCase() === n.toLowerCase()) === k);
    // Новая почта — только если отличается от почты аккаунта.
    const fresh = input.newEmail?.trim().toLowerCase() || null;
    const contactEmail = fresh && fresh !== user.email?.toLowerCase() ? fresh : null;
    const rec = await this.prisma.accountRecovery.create({
      data: {
        userId: user.id,
        reason: input.reason,
        orderNumbers,
        details: input.details.trim(),
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        contactEmail,
      },
    });
    // Просьба сменить почту — отдельной строкой: владелец, если он ещё в
    // аккаунте, должен понять, что у него хотят увести аккаунт.
    this.alert(user.id, 'recovery_requested', { recoveryId: rec.id }, (lang) =>
      contactEmail
        ? say(
            lang,
            'Подана заявка на восстановление доступа к аккаунту с просьбой сменить почту: {device}. Если это не вы — отметьте «Заявку подал не я» в «Безопасности».',
            { device: deviceOf(ctx.userAgent, lang) },
          )
        : say(
            lang,
            'Подана заявка на восстановление доступа к аккаунту: {device}. Если это не вы — отметьте «Заявку подал не я» в «Безопасности».',
            { device: deviceOf(ctx.userAgent, lang) },
          ),
    );
    return { ok: true };
  }

  /** Заявка в ожидании на своём аккаунте — для «Безопасности». IP заявителя не показывается. */
  async mine(userId: string) {
    const rec = await this.prisma.accountRecovery.findFirst({
      where: { userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    if (!rec) return { request: null };
    return {
      request: {
        id: rec.id,
        createdAt: rec.createdAt,
        userAgent: rec.userAgent,
        objected: rec.objectedAt !== null,
        newEmail: rec.contactEmail !== null,
        decideAfter: new Date(rec.createdAt.getTime() + RECOVERY_WAIT_MS),
      },
    };
  }

  /** «Заявку подал не я» — из аккаунта; сотрудник увидит, когда и с какого устройства. */
  async object(userId: string, id: string, ctx: RequestCtx) {
    const res = await this.prisma.accountRecovery.updateMany({
      where: { id, userId, status: 'pending', objectedAt: null },
      data: {
        objectedAt: new Date(),
        objectedFrom: `${deviceOf(ctx.userAgent)}${ctx.ip ? ` · IP ${ctx.ip}` : ''}`,
      },
    });
    if (!res.count) {
      const exists = await this.prisma.accountRecovery.count({
        where: { id, userId, status: 'pending' },
      });
      if (!exists) throw new NotFoundException('Заявка не найдена');
    }
    return { ok: true };
  }

  /** Очередь сотрудника: ждущие решения — старые сверху. */
  async queue(status: RecoveryStatus) {
    const rows = await this.prisma.accountRecovery.findMany({
      where: { status },
      orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      take: 100,
      include: { user: { select: { email: true, profile: { select: { username: true } } } } },
    });
    const matched = await this.matches(
      rows.map((r) => ({ userId: r.userId, numbers: r.orderNumbers })),
    );
    return rows.map((r, i) => ({
      id: r.id,
      createdAt: r.createdAt,
      status: r.status,
      reason: r.reason,
      email: r.user.email,
      username: r.user.profile?.username ?? null,
      orders: { given: r.orderNumbers.length, found: matched[i] },
      objected: r.objectedAt !== null,
      newEmail: r.contactEmail,
      decideAfter: new Date(r.createdAt.getTime() + RECOVERY_WAIT_MS),
    }));
  }

  /** Заявка целиком: что совпало с аккаунтом и что с ним происходило. */
  async detail(id: string) {
    const rec = await this.prisma.accountRecovery.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            email: true,
            emailVerified: true,
            createdAt: true,
            passwordHash: true,
            telegramId: true,
            profile: { select: { username: true } },
            twoFactor: { select: { enabledAt: true } },
            socialAccounts: { select: { provider: true, createdAt: true } },
          },
        },
      },
    });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    // Заявитель заплатил и закрыл страницу — сверим карту сейчас.
    if (rec.cardPaymentId && !rec.cardCheckedAt) {
      const settled = await this.settleCard(rec).catch(() => null);
      if (settled === 'done')
        Object.assign(rec, await this.prisma.accountRecovery.findUnique({ where: { id } }));
    }
    const [orders, history, kyc, taken, deals, cards] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          AND: [
            { OR: byNumber(rec.orderNumbers) },
            { OR: [{ buyerId: rec.userId }, { sellerId: rec.userId }] },
          ],
        },
        select: { publicNumber: true, buyerId: true, status: true, amount: true, createdAt: true },
      }),
      this.prisma.notification.findMany({
        where: { userId: rec.userId, type: { in: SECURITY_TYPES } },
        orderBy: { createdAt: 'desc' },
        take: 12,
        select: { type: true, payload: true, createdAt: true },
      }),
      this.approvedKyc(rec.userId),
      rec.contactEmail
        ? this.prisma.user.count({
            where: {
              email: { equals: rec.contactEmail, mode: 'insensitive' },
              id: { not: rec.userId },
            },
          })
        : 0,
      this.prisma.recoveryDeal.findMany({
        where: { recoveryId: id },
        orderBy: [{ createdAt: 'asc' }, { counterparty: 'asc' }],
      }),
      this.cardCounts(rec.userId),
    ]);
    const u = rec.user;
    return {
      id: rec.id,
      status: rec.status,
      reason: rec.reason,
      details: rec.details,
      createdAt: rec.createdAt,
      decideAfter: new Date(rec.createdAt.getTime() + RECOVERY_WAIT_MS),
      requester: { device: deviceOf(rec.userAgent), ip: rec.ip },
      objected: rec.objectedAt ? { at: rec.objectedAt, from: rec.objectedFrom } : null,
      decidedAt: rec.decidedAt,
      note: rec.note,
      account: {
        username: u.profile?.username ?? null,
        email: u.email,
        emailVerified: u.emailVerified !== null,
        createdAt: u.createdAt,
        hasPassword: u.passwordHash !== null,
        twoFactorSince: u.twoFactor?.enabledAt ?? null,
        telegram: u.telegramId !== null,
        social: u.socialAccounts,
      },
      orders: rec.orderNumbers.map((n) => {
        const o = orders.find((x) => x.publicNumber.toLowerCase() === n.toLowerCase());
        return o
          ? {
              number: o.publicNumber,
              found: true,
              role: o.buyerId === rec.userId ? 'buyer' : 'seller',
              status: o.status,
              amount: o.amount.toString(),
              createdAt: o.createdAt,
            }
          : { number: n, found: false };
      }),
      history: history.map((h) => {
        const p = (h.payload ?? {}) as Record<string, unknown>;
        return {
          type: h.type,
          at: h.createdAt,
          device: typeof p.device === 'string' ? p.device : null,
          ip: typeof p.ip === 'string' ? p.ip : null,
        };
      }),
      // Нет доступа к почте: новая почта и сверка документов с проверкой личности.
      contact: rec.contactEmail
        ? {
            email: rec.contactEmail,
            taken: taken > 0,
            blocker: newEmailBlocker(rec, kyc !== null, deals),
          }
        : null,
      kyc: kyc ? { approvedAt: kyc.reviewedAt, files: await this.files(kyc.documentRefs) } : null,
      evidence: rec.evidenceRequestedAt
        ? {
            requestedAt: rec.evidenceRequestedAt,
            submittedAt: rec.evidenceAt,
            files: rec.evidenceAt ? await this.files(rec.evidenceRefs) : [],
          }
        : null,
      deals: rec.dealsRequestedAt
        ? {
            requestedAt: rec.dealsRequestedAt,
            submittedAt: rec.dealsAt,
            confirmed: confirmedDeals(rec, deals),
            needed: RECOVERY_DEALS_NEEDED,
            items: await Promise.all(
              deals.map(async (d) => ({
                counterparty: d.counterparty,
                text: d.text,
                party: d.counterpartyId ? await this.party(rec, d.counterpartyId) : null,
                answer: d.answer,
                answeredAt: d.answeredAt,
                sameIp: sameIp(rec, d),
              })),
            ),
          }
        : null,
      card: {
        // Проверка картой — только через ЮKassa и если в аккаунте была карта.
        available: this.yookassa.enabled && cards.payments + cards.payouts > 0,
        payments: cards.payments,
        payouts: cards.payouts,
        requestedAt: rec.cardRequestedAt,
        checkedAt: rec.cardCheckedAt,
        result: rec.cardResult as CardResult | null,
      },
    };
  }

  /** Кто подтверждает: давно ли на площадке, сколько сделок вообще и с этим аккаунтом. */
  private async party(rec: { userId: string; createdAt: Date }, id: string) {
    const [user, completed, together] = await Promise.all([
      this.prisma.user.findUnique({ where: { id }, select: { createdAt: true } }),
      this.prisma.order.count({
        where: { status: 'completed', OR: [{ buyerId: id }, { sellerId: id }] },
      }),
      this.prisma.order.count({ where: between(rec.userId, id, rec.createdAt) }),
    ]);
    return { since: user?.createdAt ?? null, completed, together };
  }

  /**
   * Попросить документы: ссылка «Загрузите документы» уходит на новую почту
   * из заявки — открыв её, заявитель показывает, что почта его. Только при
   * пройденной проверке личности: иначе сверять не с чем. Новая просьба
   * делает прежнюю ссылку недействительной.
   */
  async requestEvidence(id: string, staffId: string, ip?: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    if (rec.status !== 'pending') throw new BadRequestException('По заявке уже решено');
    if (!rec.contactEmail) throw new BadRequestException('В заявке нет новой почты');
    if (!(await this.approvedKyc(rec.userId))) {
      throw new BadRequestException(
        'У аккаунта нет пройденной проверки личности — сверять документы не с чем',
      );
    }
    const at = new Date();
    await this.prisma.accountRecovery.update({
      where: { id },
      data: { evidenceRequestedAt: at, evidenceRefs: Prisma.DbNull, evidenceAt: null },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.request_docs',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id, to: rec.contactEmail },
      ip,
    });
    await this.mailLink(
      { id, userId: rec.userId, contactEmail: rec.contactEmail },
      'recovery_docs',
      at,
      (lang, link) => [
        say(lang, 'Восстановление доступа: загрузите документы — GameMarket'),
        say(
          lang,
          'Сотрудник проверяет заявку на восстановление доступа. Загрузите фото документа и селфи с ним — тем же, что при проверке личности (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.',
          { link },
        ),
      ],
    );
    return { ok: true, mailed: this.mail.enabled };
  }

  /**
   * Проверки личности нет — попросить описать сделки ссылкой на новую почту,
   * как документы. Новая просьба гасит прежнюю ссылку и прежние описания
   * вместе с ответами на них.
   */
  async requestDeals(id: string, staffId: string, ip?: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    if (rec.status !== 'pending') throw new BadRequestException('По заявке уже решено');
    if (!rec.contactEmail) throw new BadRequestException('В заявке нет новой почты');
    if (await this.approvedKyc(rec.userId)) {
      throw new BadRequestException(
        'У аккаунта пройдена проверка личности — попросите документы, они надёжнее',
      );
    }
    const at = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.recoveryDeal.deleteMany({ where: { recoveryId: id } });
      await tx.accountRecovery.update({
        where: { id },
        data: { dealsRequestedAt: at, dealsAt: null, dealsIp: null },
      });
    });
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.request_deals',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id, to: rec.contactEmail },
      ip,
    });
    await this.mailLink(
      { id, userId: rec.userId, contactEmail: rec.contactEmail },
      'recovery_deals',
      at,
      (lang, link) => [
        say(lang, 'Восстановление доступа: опишите сделки — GameMarket'),
        say(
          lang,
          'Сотрудник проверяет заявку на восстановление доступа. Проверки личности у аккаунта нет, поэтому опишите две-три сделки с разными продавцами или покупателями — мы спросим их, совпадает ли описание (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.',
          { link },
        ),
      ],
    );
    return { ok: true, mailed: this.mail.enabled };
  }

  /** Страница сделок по ссылке из письма: действует ли ссылка и прислали ли уже. */
  async dealsStatus(token: string) {
    const rec = await this.byLinkToken(token, 'recovery_deals');
    return { ok: true, submitted: rec.dealsAt !== null };
  }

  /**
   * Описания сделок по ссылке — один раз. Спрашиваем другую сторону, только
   * если у аккаунта есть с ней сделки, завершённые до заявки; ответ заявителю
   * один и тот же — по нему не узнать, с кем аккаунт торговал.
   */
  async dealsSubmit(
    token: string,
    deals: Array<{ counterparty: string; text: string }>,
    ip?: string,
  ) {
    const rec = await this.byLinkToken(token, 'recovery_deals');
    if (rec.dealsAt) throw new ConflictException('Описания уже отправлены');
    const names = deals.map((d) => d.counterparty.trim().replace(/^@/, ''));
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
      throw new BadRequestException('Каждая сделка — с другим продавцом или покупателем');
    }
    const rows = await Promise.all(
      deals.map(async (d, i) => ({
        id: randomUUID(),
        recoveryId: rec.id,
        counterparty: names[i]!,
        text: d.text.trim(),
        counterpartyId: await this.counterpartyOf(rec, names[i]!),
      })),
    );
    const done = await this.prisma.$transaction(async (tx) => {
      const res = await tx.accountRecovery.updateMany({
        where: {
          id: rec.id,
          status: 'pending',
          dealsAt: null,
          dealsRequestedAt: rec.dealsRequestedAt,
        },
        data: { dealsAt: new Date(), dealsIp: ip ?? null },
      });
      if (!res.count) return false;
      await tx.recoveryDeal.createMany({ data: rows });
      return true;
    });
    if (!done) throw new ConflictException('Описания уже отправлены');
    const owner = await this.prisma.user.findUnique({
      where: { id: rec.userId },
      select: { profile: { select: { username: true } } },
    });
    const username = owner?.profile?.username ?? '';
    for (const r of rows) {
      if (!r.counterpartyId) continue;
      this.alert(r.counterpartyId, 'deal_check', { checkId: r.id, username }, (lang) =>
        say(
          lang,
          '@{username}, с кем вы заключали сделки, восстанавливает доступ к аккаунту. Сверьте описание сделки — ответ увидит только сотрудник.',
          { username },
        ),
      );
    }
    return { ok: true };
  }

  /** Другая сторона: живой аккаунт с этим ником и сделки с ним, завершённые до заявки. */
  private async counterpartyOf(rec: { userId: string; createdAt: Date }, username: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: { not: rec.userId },
        status: 'active',
        deletedAt: null,
        profile: { username: { equals: username, mode: 'insensitive' } },
      },
      select: { id: true },
    });
    if (!user) return null;
    const deals = await this.prisma.order.count({
      where: between(rec.userId, user.id, rec.createdAt),
    });
    return deals ? user.id : null;
  }

  /** Просьбы подтвердить сделку — другой стороне, в кабинете; с её сделками с этим аккаунтом. */
  async checks(userId: string) {
    const rows = await this.prisma.recoveryDeal.findMany({
      where: { counterpartyId: userId, answer: null, recovery: { status: 'pending' } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        recovery: {
          select: {
            userId: true,
            createdAt: true,
            user: { select: { profile: { select: { username: true } } } },
          },
        },
      },
    });
    return Promise.all(
      rows.map(async (r) => {
        const orders = await this.prisma.order.findMany({
          where: between(r.recovery.userId, userId, r.recovery.createdAt),
          orderBy: { completedAt: 'desc' },
          take: 5,
          select: {
            id: true,
            publicNumber: true,
            listingSnapshot: true,
            amount: true,
            currency: true,
            completedAt: true,
            sellerId: true,
          },
        });
        return {
          id: r.id,
          createdAt: r.createdAt,
          username: r.recovery.user.profile?.username ?? null,
          text: r.text,
          deals: orders.map((o) => ({
            id: o.id,
            number: o.publicNumber,
            title: (o.listingSnapshot as { title?: string } | null)?.title ?? null,
            amount: o.amount.toString(),
            currency: o.currency,
            completedAt: o.completedAt,
            youSold: o.sellerId === userId,
          })),
        };
      }),
    );
  }

  /** Ответ другой стороны — один раз и только на свою просьбу, пока заявка ждёт решения. */
  async answerCheck(userId: string, id: string, answer: DealAnswer, ip?: string) {
    const res = await this.prisma.recoveryDeal.updateMany({
      where: { id, counterpartyId: userId, answer: null, recovery: { status: 'pending' } },
      data: { answer, answeredAt: new Date(), answerIp: ip ?? null },
    });
    if (res.count) return { ok: true };
    const mine = await this.prisma.recoveryDeal.findFirst({
      where: { id, counterpartyId: userId },
      select: { answer: true },
    });
    if (mine?.answer) throw new ConflictException('Вы уже ответили');
    throw new NotFoundException('Просьба не найдена или заявку уже решили');
  }

  /**
   * Попросить проверку картой ссылкой на новую почту — если в аккаунте
   * платили картой или выводили на неё и приём платежей идёт через ЮKassa.
   * Новая просьба гасит прежнюю ссылку и итог прежней проверки.
   */
  async requestCard(id: string, staffId: string, ip?: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    if (rec.status !== 'pending') throw new BadRequestException('По заявке уже решено');
    if (!rec.contactEmail) throw new BadRequestException('В заявке нет новой почты');
    if (!this.yookassa.enabled) {
      throw new BadRequestException(
        'Проверка картой работает только с приёмом оплаты через ЮKassa',
      );
    }
    const cards = await this.cardCounts(rec.userId);
    if (!cards.payments && !cards.payouts) {
      throw new BadRequestException(
        'В аккаунте не платили картой и не выводили на карту — сверять не с чем',
      );
    }
    // Прежняя блокировка, если заявитель её не довёл, — снять.
    if (rec.cardPaymentId && !rec.cardCheckedAt) this.release(rec.cardPaymentId);
    const at = new Date();
    await this.prisma.accountRecovery.update({
      where: { id },
      data: {
        cardRequestedAt: at,
        cardPaymentId: null,
        cardCheckedAt: null,
        cardResult: Prisma.DbNull,
      },
    });
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.request_card',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id, to: rec.contactEmail },
      ip,
    });
    await this.mailLink(
      { id, userId: rec.userId, contactEmail: rec.contactEmail },
      'recovery_card',
      at,
      (lang, link) => [
        say(lang, 'Восстановление доступа: проверка картой — GameMarket'),
        say(
          lang,
          'Сотрудник проверяет заявку на восстановление доступа. Заплатите 1 ₽ картой, которой вы платили на GameMarket или на которую выводили деньги: сумма только заблокируется и сразу вернётся (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.',
          { link },
        ),
      ],
    );
    return { ok: true, mailed: this.mail.enabled };
  }

  /**
   * Страница проверки картой: open — можно платить, waiting — ЮKassa ещё не
   * ответила, done — карта сверена. failed — прошлая попытка не прошла.
   * Совпала ли карта, заявителю не говорим: это решает сотрудник.
   */
  async cardStatus(token: string) {
    const rec = await this.byLinkToken(token, 'recovery_card');
    if (rec.cardCheckedAt) return { ok: true, state: 'done' as const };
    if (!rec.cardPaymentId) return { ok: true, state: 'open' as const };
    const state = await this.settleCard(rec);
    return state === 'failed'
      ? { ok: true, state: 'open' as const, failed: true }
      : { ok: true, state };
  }

  /** Перейти к оплате 1 ₽: одна блокировка на ссылку; начатая — та же страница ЮKassa. */
  async cardPay(token: string) {
    const rec = await this.byLinkToken(token, 'recovery_card');
    if (rec.cardCheckedAt) throw new ConflictException('Карта уже проверена');
    if (rec.cardPaymentId) {
      const state = await this.settleCard(rec);
      if (state === 'done') throw new ConflictException('Карта уже проверена');
      if (state === 'waiting') {
        const p = await this.yookassa.payment(rec.cardPaymentId);
        if (p?.url) return { url: p.url };
      }
    }
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    const hold = await this.yookassa.createHold({
      amount: CARD_CHECK_AMOUNT,
      description: 'GameMarket: проверка карты для восстановления доступа, деньги не спишутся',
      returnUrl: `${web}/recover/card?token=${encodeURIComponent(token)}`,
      idempotenceKey: `rc-${randomUUID()}`,
      metadata: { purpose: CARD_CHECK_PURPOSE, recoveryId: rec.id },
    });
    const took = await this.prisma.accountRecovery.updateMany({
      where: {
        id: rec.id,
        status: 'pending',
        cardPaymentId: null,
        cardCheckedAt: null,
        cardRequestedAt: rec.cardRequestedAt,
      },
      data: { cardPaymentId: hold.id },
    });
    if (!took.count) {
      this.release(hold.id);
      throw new ConflictException('Оплата уже начата — обновите страницу');
    }
    return { url: hold.url };
  }

  /**
   * Сверить карту проверочного платежа: ЮKassa заблокировала сумму — карта
   * известна, сверяем с картами аккаунта и снимаем блокировку. Платёж
   * отменён до оплаты — попытку можно повторить.
   */
  private async settleCard(rec: AccountRecovery): Promise<'waiting' | 'done' | 'failed'> {
    const paymentId = rec.cardPaymentId!;
    const p = await this.yookassa.payment(paymentId);
    if (p && p.metadata.recoveryId !== rec.id)
      throw new BadRequestException('Ссылка недействительна или истекла');
    if (p?.status === 'pending') return 'waiting';
    // Карта доказывает что-то, только если банк пропустил платёж (код из
    // банка и деньги на карте): отклонённый или отменённый — не доказательство.
    if (!p?.card || (p.status !== 'waiting_for_capture' && p.status !== 'succeeded')) {
      await this.prisma.accountRecovery.updateMany({
        where: { id: rec.id, cardPaymentId: paymentId, cardCheckedAt: null },
        data: { cardPaymentId: null },
      });
      return 'failed';
    }
    const history = await this.cardHistory(rec.userId);
    const hits = history
      .filter((h) => h.first6 === p.card!.first6 && h.last4 === p.card!.last4)
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const result: CardResult = {
      ...p.card,
      matched: hits.length > 0,
      firstUsedAt: hits[0]?.at.toISOString() ?? null,
      source: hits[0]?.source ?? null,
    };
    await this.prisma.accountRecovery.updateMany({
      where: { id: rec.id, cardPaymentId: paymentId, cardCheckedAt: null },
      data: { cardCheckedAt: new Date(), cardResult: { ...result } as Prisma.InputJsonValue },
    });
    if (p.status === 'waiting_for_capture') this.release(paymentId);
    else if (p.status === 'succeeded') {
      // Так быть не должно: платёж создаётся без списания.
      this.logger.error(`Проверка карты ${paymentId}: платёж списан — верните 1 ₽ вручную`);
    }
    return 'done';
  }

  /** Снять блокировку проверочного платежа; не вышло — ЮKassa снимет сама через неделю. */
  private release(paymentId: string) {
    void this.yookassa
      .cancel(paymentId)
      .catch((e: Error) => this.logger.warn(`Проверка карты ${paymentId}: ${e.message}`));
  }

  /** Сколько раз в аккаунте платили картой через ЮKassa и выводили на карту. */
  private async cardCounts(userId: string) {
    const [payments, payouts] = await Promise.all([
      this.prisma.payment.count({
        where: { userId, provider: 'yookassa', status: 'succeeded', method: { in: CARD_METHODS } },
      }),
      this.prisma.payout.count({ where: { userId, method: 'card', status: 'paid' } }),
    ]);
    return { payments, payouts };
  }

  /**
   * Карты аккаунта: оплаты картой через ЮKassa (у старых оплат карту
   * спрашиваем у ЮKassa и запоминаем) и выплаты на карту — с датой.
   */
  private async cardHistory(userId: string) {
    const [payments, payouts] = await Promise.all([
      this.prisma.payment.findMany({
        where: { userId, provider: 'yookassa', status: 'succeeded', method: { in: CARD_METHODS } },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: { id: true, externalId: true, card: true, createdAt: true },
      }),
      this.prisma.payout.findMany({
        where: { userId, method: 'card', status: 'paid' },
        orderBy: { createdAt: 'asc' },
        take: 100,
        select: { destinationEnc: true, createdAt: true },
      }),
    ]);
    const out: Array<{ first6: string; last4: string; at: Date; source: 'payment' | 'payout' }> =
      [];
    for (const p of payments) {
      let card = p.card as CardPrint | null;
      if (!card && p.externalId) {
        card = (await this.yookassa.payment(p.externalId).catch(() => null))?.card ?? null;
        if (card) {
          await this.prisma.payment.update({ where: { id: p.id }, data: { card: { ...card } } });
        }
      }
      if (card)
        out.push({ first6: card.first6, last4: card.last4, at: p.createdAt, source: 'payment' });
    }
    for (const p of payouts) {
      try {
        const d = JSON.parse(this.encryption.decrypt(p.destinationEnc)) as Partial<CardPrint>;
        if (d.first6 && d.last4) {
          out.push({ first6: d.first6, last4: d.last4, at: p.createdAt, source: 'payout' });
        }
      } catch {
        // Реквизиты не карты из виджета — сверять нечего.
      }
    }
    return out;
  }

  /** Страница документов по ссылке из письма: действует ли ссылка и прислали ли уже. */
  async docsStatus(token: string) {
    const rec = await this.byLinkToken(token, 'recovery_docs');
    return { ok: true, submitted: rec.evidenceAt !== null };
  }

  /** Подписанная ссылка на загрузку файла — по ссылке из письма. */
  async docsUpload(token: string, mime: string) {
    const rec = await this.byLinkToken(token, 'recovery_docs');
    if (rec.evidenceAt) throw new ConflictException('Документы уже отправлены');
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = DOC_TYPES[mime];
    if (!ext) throw new BadRequestException('Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF');
    const key = `recovery/${rec.id}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  /** Документы по ссылке: только загруженные к этой заявке и прошедшие антивирус. */
  async docsSubmit(token: string, documentKeys: string[], selfieKey: string) {
    const rec = await this.byLinkToken(token, 'recovery_docs');
    if (rec.evidenceAt) throw new ConflictException('Документы уже отправлены');
    const own = (k: string) =>
      k.startsWith(`recovery/${rec.id}/`) && SAFE_KEY.test(k) && !k.includes('..');
    const files = [...documentKeys, selfieKey];
    if (!files.every(own)) {
      throw new BadRequestException('Файлы не из этой заявки — загрузите их заново');
    }
    if (new Set(files).size !== files.length)
      throw new BadRequestException('Одно и то же фото дважды');
    for (const key of files) {
      const bytes = await this.storage.getBytes(key).catch(() => null);
      if (!bytes) throw new BadRequestException('Файл не загрузился — добавьте его ещё раз');
      const result = await this.scanner.scan(bytes);
      if (!result.clean) {
        await this.storage.remove(key);
        throw new BadRequestException(`Файл не прошёл антивирус-проверку: ${result.reason}`);
      }
    }
    const done = await this.prisma.accountRecovery.updateMany({
      where: {
        id: rec.id,
        status: 'pending',
        evidenceAt: null,
        evidenceRequestedAt: rec.evidenceRequestedAt,
      },
      data: {
        evidenceRefs: { keys: documentKeys, selfie: selfieKey } as Prisma.InputJsonValue,
        evidenceAt: new Date(),
      },
    });
    if (!done.count) throw new ConflictException('Документы уже отправлены');
    return { ok: true };
  }

  /**
   * Восстановить доступ: выключить вход с кодом, отвязать вход через сервисы,
   * Telegram и пуши, вывести все устройства и сбросить пароль — войти не
   * сможет никто, пока владелец не задаст новый по ссылке из письма на почту
   * аккаунта (сутки, один раз).
   */
  async restore(id: string, staffId: string, ip?: string, now = new Date()) {
    const rec = await this.pendingOrThrow(id, now);
    await this.reset(rec, staffId, now);
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.restore',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id },
      ip,
    });
    this.sendReset(rec.userId, id);
    return { ok: true };
  }

  /**
   * Восстановить на новую почту — когда нет доступа и к почте аккаунта. Те же
   * сбросы плюс смена почты; можно, только если новая почта не занята и
   * доказательство собрано: карта, документы при проверке личности, без неё —
   * подтверждения сделок (см. newEmailBlocker). Старой почте — письмо, что
   * её сменили; ссылка задать пароль — на новую.
   */
  async restoreToNewEmail(id: string, staffId: string, ip?: string, now = new Date()) {
    const rec = await this.pendingOrThrow(id, now);
    const kyc = (await this.approvedKyc(rec.userId)) !== null;
    const deals = kyc ? [] : await this.prisma.recoveryDeal.findMany({ where: { recoveryId: id } });
    const blocker = newEmailBlocker(rec, kyc, deals);
    const proof =
      rec.cardRequestedAt && cardBlocker(rec) === null ? 'card' : kyc ? 'documents' : 'deals';
    if (blocker || !rec.contactEmail) {
      throw new BadRequestException(blocker ?? 'В заявке нет новой почты');
    }
    const taken = await this.prisma.user.count({
      where: { email: { equals: rec.contactEmail, mode: 'insensitive' }, id: { not: rec.userId } },
    });
    if (taken) throw new ConflictException('Эта почта уже у другого аккаунта');
    const before = await this.prisma.user.findUnique({
      where: { id: rec.userId },
      select: { email: true, locale: true },
    });
    await this.reset(rec, staffId, now, rec.contactEmail);
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.restore_new_email',
      entityType: 'user',
      entityId: rec.userId,
      before: { email: before?.email ?? null },
      after: { recoveryId: id, email: rec.contactEmail, proof },
      ip,
    });
    if (before?.email) {
      const lang = langOf(before.locale);
      const email = maskEmail(rec.contactEmail);
      await this.mail.send(
        before.email,
        say(lang, 'Почта аккаунта изменена — GameMarket'),
        proof === 'card'
          ? say(
              lang,
              'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: заявитель заплатил картой, которой платили в аккаунте. Если это не вы — ответьте на это письмо.',
              { email },
            )
          : proof === 'documents'
            ? say(
                lang,
                'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: сотрудник сверил документы с проверкой личности. Если это не вы — ответьте на это письмо.',
                { email },
              )
            : say(
                lang,
                'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: сделки из заявки подтвердили их участники. Если это не вы — ответьте на это письмо.',
                { email },
              ),
      );
    }
    this.sendReset(rec.userId, id);
    return { ok: true };
  }

  /** Сбросить всё, чем мог завладеть чужой; при смене почты — и почту. */
  private async reset(
    rec: { id: string; userId: string },
    staffId: string,
    now: Date,
    newEmail?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.accountRecovery.updateMany({
        where: { id: rec.id, status: 'pending' },
        data: { status: 'restored', decidedById: staffId, decidedAt: now },
      });
      if (!done.count) throw new BadRequestException('По заявке уже решено');
      await tx.twoFactor.deleteMany({ where: { userId: rec.userId } });
      await tx.socialAccount.deleteMany({ where: { userId: rec.userId } });
      await tx.pushSubscription.deleteMany({ where: { userId: rec.userId } });
      await tx.authSession.deleteMany({ where: { userId: rec.userId } });
      await tx.user.update({
        where: { id: rec.userId },
        data: {
          passwordHash: null,
          telegramId: null,
          // Почта подтверждена: заявитель открыл ссылку, пришедшую на неё.
          ...(newEmail ? { email: newEmail, emailVerified: now } : {}),
        },
      });
    });
  }

  /** Ссылка задать пароль — на почту аккаунта (после смены — уже новую), сутки, один раз. */
  private sendReset(userId: string, recoveryId: string) {
    const token = this.tokens.signPurpose(
      userId,
      'pwd_reset',
      NOT_ME_RESET_TTL,
      passwordStamp(null),
    );
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    this.alert(
      userId,
      'recovery_restored',
      { recoveryId },
      (lang) =>
        say(
          lang,
          'Доступ к аккаунту восстановлен: вход с кодом выключен, вход через сервисы отвязан, все устройства вышли. Задайте новый пароль по ссылке из письма.',
        ),
      { action: 'Задать новый пароль', link: `${web}/reset?token=${encodeURIComponent(token)}` },
    );
  }

  /** Отклонить с причиной — она придёт на почту аккаунта. */
  async reject(id: string, staffId: string, note: string, ip?: string) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    const done = await this.prisma.accountRecovery.updateMany({
      where: { id, status: 'pending' },
      data: { status: 'rejected', decidedById: staffId, decidedAt: new Date(), note },
    });
    if (!done.count) throw new BadRequestException('По заявке уже решено');
    await this.audit.log({
      actorId: staffId,
      action: 'recovery.reject',
      entityType: 'user',
      entityId: rec.userId,
      after: { recoveryId: id, note },
      ip,
    });
    this.alert(rec.userId, 'recovery_rejected', { recoveryId: id }, (lang) =>
      say(lang, 'Заявка на восстановление доступа отклонена: {note}', { note }),
    );
    return { ok: true };
  }

  private async pendingOrThrow(id: string, now: Date) {
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('Заявка не найдена');
    if (rec.status !== 'pending') throw new BadRequestException('По заявке уже решено');
    if (now.getTime() < rec.createdAt.getTime() + RECOVERY_WAIT_MS) {
      throw new BadRequestException(
        'Решить можно через 3 дня после заявки: владелец должен успеть её увидеть',
      );
    }
    return rec;
  }

  /** Сколько номеров заказов из каждой заявки — у этого аккаунта. */
  private async matches(items: Array<{ userId: string; numbers: string[] }>) {
    const all = items.flatMap((i) => i.numbers);
    if (!all.length) return items.map(() => 0);
    const orders = await this.prisma.order.findMany({
      where: { OR: byNumber(all) },
      select: { publicNumber: true, buyerId: true, sellerId: true },
    });
    return items.map(
      (i) =>
        orders.filter(
          (o) =>
            i.numbers.some((n) => n.toLowerCase() === o.publicNumber.toLowerCase()) &&
            (o.buyerId === i.userId || o.sellerId === i.userId),
        ).length,
    );
  }

  /** Одобренная проверка личности с документом — с ней сверяют присланное по ссылке. */
  private approvedKyc(userId: string) {
    return this.prisma.kycVerification.findFirst({
      where: { userId, status: 'approved', level: 'document' },
      orderBy: { reviewedAt: 'desc' },
      select: { documentRefs: true, reviewedAt: true },
    });
  }

  /** Файлы документов — сотруднику по ссылкам на час. */
  private async files(refs: Prisma.JsonValue | null) {
    if (!this.storage.enabled) return [];
    const r = (refs ?? {}) as Refs;
    const all = [
      ...(r.keys ?? []).map((key) => ({ key, kind: 'document' as const })),
      ...(r.selfie ? [{ key: r.selfie, kind: 'selfie' as const }] : []),
    ];
    return Promise.all(
      all.map(async (f) => ({
        kind: f.kind,
        pdf: f.key.endsWith('.pdf'),
        url: await this.storage.presignGet(f.key, 3600),
      })),
    );
  }

  /**
   * Заявка по ссылке из письма — «Загрузите документы» или «Опишите сделки»:
   * ссылка из последней просьбы, заявка ждёт решения.
   */
  private async byLinkToken(token: string, purpose: LinkPurpose) {
    let data: { rid: string; at: number };
    try {
      data = this.tokens.verifyData<{ rid: string; at: number }>(token, purpose);
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id: data.rid } });
    const asked = {
      recovery_docs: rec?.evidenceRequestedAt,
      recovery_deals: rec?.dealsRequestedAt,
      recovery_card: rec?.cardRequestedAt,
    }[purpose];
    if (!rec || rec.status !== 'pending' || asked?.getTime() !== data.at) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    return rec;
  }

  /** Письмо со ссылкой на новую почту из заявки — на языке аккаунта, неделю. */
  private async mailLink(
    rec: { id: string; userId: string; contactEmail: string },
    purpose: LinkPurpose,
    at: Date,
    letter: (lang: 'ru' | 'en', link: string) => [string, string],
  ) {
    const token = this.tokens.signData(
      { rid: rec.id, at: at.getTime() },
      purpose,
      RECOVERY_DOCS_TTL,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: rec.userId },
      select: { locale: true },
    });
    const path = {
      recovery_docs: '/recover/docs',
      recovery_deals: '/recover/deals',
      recovery_card: '/recover/card',
    }[purpose];
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    const [subject, body] = letter(
      langOf(user?.locale),
      `${web}${path}?token=${encodeURIComponent(token)}`,
    );
    await this.mail.send(rec.contactEmail, subject, body);
  }

  /**
   * Уведомление на языке получателя: владельцу аккаунта — письмом всегда
   * (группа «Безопасность»), другой стороне сделки — как заказы.
   */
  private alert(
    userId: string,
    type: 'recovery_requested' | 'recovery_restored' | 'recovery_rejected' | 'deal_check',
    data: Record<string, string>,
    preview: (lang: 'ru' | 'en') => string,
    mail?: { action: string; link: string },
  ) {
    const send = async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true },
      });
      const lang = langOf(user?.locale);
      await this.notifications.notify(
        userId,
        type,
        { ...data, preview: preview(lang) },
        mail ? { mail } : {},
      );
    };
    void send().catch((e: Error) => this.logger.warn(`Восстановление ${userId}: ${e.message}`));
  }
}
