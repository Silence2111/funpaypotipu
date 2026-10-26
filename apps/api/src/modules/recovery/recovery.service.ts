import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { deviceOf } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../access/audit.service';
import { TokenService } from '../auth/token.service';
import { NOT_ME_RESET_TTL, passwordStamp, type RequestCtx } from '../auth/auth.service';
import { SAFE_KEY, StorageService } from '../storage/storage.service';
import { ScanService } from '../antivirus/scan.service';
import { MailService } from '../mail/mail.service';
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
    const [orders, history, kyc, taken] = await Promise.all([
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
      contact: rec.contactEmail ? { email: rec.contactEmail, taken: taken > 0 } : null,
      kyc: kyc ? { approvedAt: kyc.reviewedAt, files: await this.files(kyc.documentRefs) } : null,
      evidence: rec.evidenceRequestedAt
        ? {
            requestedAt: rec.evidenceRequestedAt,
            submittedAt: rec.evidenceAt,
            files: rec.evidenceAt ? await this.files(rec.evidenceRefs) : [],
          }
        : null,
    };
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
    const token = this.tokens.signData(
      { rid: id, at: at.getTime() },
      'recovery_docs',
      RECOVERY_DOCS_TTL,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: rec.userId },
      select: { locale: true },
    });
    const lang = langOf(user?.locale);
    const web = process.env.WEB_URL ?? 'http://localhost:3000';
    await this.mail.send(
      rec.contactEmail,
      say(lang, 'Восстановление доступа: загрузите документы — GameMarket'),
      say(
        lang,
        'Сотрудник проверяет заявку на восстановление доступа. Загрузите фото документа и селфи с ним — тем же, что при проверке личности (ссылка действует неделю): {link}\nЕсли заявку подавали не вы — проигнорируйте письмо.',
        { link: `${web}/recover/docs?token=${encodeURIComponent(token)}` },
      ),
    );
    return { ok: true, mailed: this.mail.enabled };
  }

  /** Страница документов по ссылке из письма: действует ли ссылка и прислали ли уже. */
  async docsStatus(token: string) {
    const rec = await this.byDocsToken(token);
    return { ok: true, submitted: rec.evidenceAt !== null };
  }

  /** Подписанная ссылка на загрузку файла — по ссылке из письма. */
  async docsUpload(token: string, mime: string) {
    const rec = await this.byDocsToken(token);
    if (rec.evidenceAt) throw new ConflictException('Документы уже отправлены');
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = DOC_TYPES[mime];
    if (!ext) throw new BadRequestException('Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF');
    const key = `recovery/${rec.id}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  /** Документы по ссылке: только загруженные к этой заявке и прошедшие антивирус. */
  async docsSubmit(token: string, documentKeys: string[], selfieKey: string) {
    const rec = await this.byDocsToken(token);
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
   * сбросы плюс смена почты; можно, только если новая почта не занята, у
   * аккаунта пройдена проверка личности и документы по ссылке присланы.
   * Старой почте — письмо, что её сменили; ссылка задать пароль — на новую.
   */
  async restoreToNewEmail(id: string, staffId: string, ip?: string, now = new Date()) {
    const rec = await this.pendingOrThrow(id, now);
    if (!rec.contactEmail) throw new BadRequestException('В заявке нет новой почты');
    if (!rec.evidenceAt) throw new BadRequestException('Документы по ссылке ещё не присланы');
    if (!(await this.approvedKyc(rec.userId))) {
      throw new BadRequestException(
        'У аккаунта нет пройденной проверки личности — сверять документы не с чем',
      );
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
      after: { recoveryId: id, email: rec.contactEmail },
      ip,
    });
    if (before?.email) {
      const lang = langOf(before.locale);
      await this.mail.send(
        before.email,
        say(lang, 'Почта аккаунта изменена — GameMarket'),
        say(
          lang,
          'Почта аккаунта GameMarket изменена на {email} по заявке на восстановление доступа: сотрудник сверил документы с проверкой личности. Если это не вы — ответьте на это письмо.',
          { email: maskEmail(rec.contactEmail) },
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

  /** Заявка по ссылке «Загрузите документы»: ссылка из последней просьбы, заявка ждёт решения. */
  private async byDocsToken(token: string) {
    let data: { rid: string; at: number };
    try {
      data = this.tokens.verifyData<{ rid: string; at: number }>(token, 'recovery_docs');
    } catch {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    const rec = await this.prisma.accountRecovery.findUnique({ where: { id: data.rid } });
    if (!rec || rec.status !== 'pending' || rec.evidenceRequestedAt?.getTime() !== data.at) {
      throw new BadRequestException('Ссылка недействительна или истекла');
    }
    return rec;
  }

  /** Уведомление владельцу аккаунта: письмом — всегда (группа «Безопасность»). */
  private alert(
    userId: string,
    type: 'recovery_requested' | 'recovery_restored' | 'recovery_rejected',
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
