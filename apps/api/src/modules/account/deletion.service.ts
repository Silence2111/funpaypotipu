import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@gamemarket/db';
import {
  CONSENT_ERASE_DAYS,
  DELETION_BLOCKED,
  DELETION_GRACE_DAYS,
  eraseAt,
  erasedUsername,
  forfeitBalance,
  hasBlockers,
  type DeletionBlockers,
} from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { STAFF_ROLES } from '../access/staff';
import { NotificationsService } from '../notifications/notifications.service';
import { SearchService } from '../search/search.service';
import { StorageService } from '../storage/storage.service';
import { TwoFactorService } from '../auth/twofactor.service';
import { RetentionService } from '../retention/retention.service';

const DAY_MS = 24 * 3600_000;
/** Проход уничтожения: раз в час; в e2e — раз в 2 с. */
const SWEEP_MS = Number(process.env.ACCOUNT_ERASE_SWEEP_MS ?? 3600_000);
/** Сделки в работе: деньги у площадки или спор — другая сторона ждёт. */
const OPEN_ORDERS = ['paid', 'delivered', 'disputed'] as const;
const PAYOUT_PENDING = ['requested', 'approved', 'processing'] as const;

/**
 * Удаление аккаунта и отзыв согласия (часть 124).
 *
 * Удалить можно, только когда нечего доводить: сделки, споры, деньги на
 * балансе и выводе, роль сотрудника. Удалённый аккаунт сразу пропадает:
 * вход закрыт, сеансы завершены, лоты сняты, подписки и запросы закрыты. 30
 * дней его можно восстановить входом; потом проход уничтожает
 * персональные данные — почту, имя, «о себе», аватар, вход, реквизиты,
 * документы. Сделки, движение денег и переписка по сделкам остаются: их
 * обрабатываем без согласия — для исполнения договора, бухучёта и споров
 * (ст. 6 ч. 1 152-ФЗ). Ник в них — `deleted_…`.
 *
 * Отзыв согласия: подборки и предложения больше не приходят сразу
 * (уведомления), а через 30 дней уничтожается то, что было только по
 * согласию: имя на витрине, «о себе», аватар, адреса и браузеры
 * завершённых входов, устройства для пушей, сохранённые поиски, ожидания
 * поступления и подписки.
 */
@Injectable()
export class DeletionService {
  private readonly logger = new Logger(DeletionService.name);
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly notifications: NotificationsService,
    private readonly search: SearchService,
    private readonly storage: StorageService,
    private readonly twoFactor: TwoFactorService,
    // Журнал и акт об уничтожении (часть 147); в юнит-тестах — без него.
    @Optional() private readonly retention?: RetentionService,
  ) {}

  /** Что мешает удалить аккаунт — то же, что проверит само удаление. */
  async blockers(userId: string): Promise<DeletionBlockers> {
    const [orders, disputes, balance, payouts, staff] = await Promise.all([
      this.prisma.order.count({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: { in: [...OPEN_ORDERS] } },
      }),
      this.prisma.dispute.count({
        where: { order: { OR: [{ buyerId: userId }, { sellerId: userId }] }, status: { in: ['open', 'in_review'] } },
      }),
      this.prisma.ledgerAccount.aggregate({
        where: { ownerType: 'user', ownerId: userId, kind: 'available' },
        _sum: { balance: true },
      }),
      this.prisma.payout.count({ where: { userId, status: { in: [...PAYOUT_PENDING] } } }),
      this.prisma.userRole.count({ where: { userId, role: { key: { in: [...STAFF_ROLES] } } } }),
    ]);
    return { orders, disputes, balance: (balance._sum.balance ?? 0n).toString(), payouts, staff: staff > 0 };
  }

  async status(userId: string) {
    const [user, blockers, twoFactor] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
      this.blockers(userId),
      this.twoFactor.isEnabled(userId),
    ]);
    return {
      blockers,
      canDelete: !hasBlockers(blockers),
      // Остаток меньше вывода: сгорит, форма просит подтвердить.
      forfeit: forfeitBalance(blockers).toString(),
      // Что спросит форма: пароль — если он есть, код — если вход с кодом.
      needsPassword: !!user?.passwordHash,
      needsCode: twoFactor,
      graceDays: DELETION_GRACE_DAYS,
    };
  }

  /**
   * Удалить аккаунт. Подтверждение — ник (от случайного нажатия), пароль и
   * код из приложения, если они есть (от чужого с открытой вкладкой).
   */
  async request(userId: string, input: { username: string; password?: string; code?: string; forfeit?: boolean }) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { passwordHash: true, deletedAt: true, profile: { select: { username: true } } },
    });
    if (!user?.profile || user.deletedAt) throw new UnauthorizedException('Пользователь не найден');
    if (input.username.trim().toLowerCase() !== user.profile.username.toLowerCase()) {
      throw new BadRequestException('Ник не совпадает — впишите свой ник, чтобы подтвердить удаление');
    }
    if (user.passwordHash && !(input.password && (await bcrypt.compare(input.password, user.passwordHash)))) {
      throw new UnauthorizedException('Пароль не подошёл');
    }
    const second = await this.twoFactor.check(userId, input.code);
    if (second !== 'ok') throw TwoFactorService.loginError(second);

    const blockers = await this.blockers(userId);
    if (hasBlockers(blockers)) {
      throw new ConflictException({
        statusCode: 409,
        message: 'Сначала доведите сделки и споры и выведите деньги — тогда аккаунт можно удалить',
        error: DELETION_BLOCKED,
        blockers,
      });
    }
    const left = forfeitBalance(blockers);
    if (left > 0n && !input.forfeit) {
      throw new ConflictException({
        statusCode: 409,
        message: 'На балансе остаток меньше минимального вывода — подтвердите, что он сгорит',
        error: 'deletion_forfeit',
        forfeit: left.toString(),
      });
    }

    const now = new Date();
    const lots = await this.prisma.listing.findMany({
      where: { sellerId: userId, status: { not: 'archived' } },
      select: { id: true },
    });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { deletedAt: now } }),
      this.prisma.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
      // Лоты — в архив: из каталога и кабинета пропадают, заказы на них остаются целыми.
      this.prisma.listing.updateMany({
        where: { sellerId: userId, status: { not: 'archived' } },
        data: { status: 'archived', pausedForAway: false },
      }),
      // Неоплаченные заказы — отменены: платить за них некому и не у кого.
      this.prisma.order.updateMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }], status: 'created' },
        data: { status: 'cancelled' },
      }),
      this.prisma.buyRequest.updateMany({ where: { buyerId: userId, status: 'open' }, data: { status: 'closed' } }),
      this.prisma.savedSearch.deleteMany({ where: { userId } }),
      this.prisma.stockWatch.deleteMany({ where: { userId } }),
      this.prisma.sellerFollow.deleteMany({ where: { OR: [{ userId }, { sellerId: userId }] } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
    ]);
    for (const l of lots) await this.search.removeListing(l.id).catch(() => undefined);
    // Письмо — последнее, что получит человек: когда сотрём и как вернуть.
    await this.notifications
      .notify(userId, 'account_deleted', { eraseAt: eraseAt(now).toISOString() })
      .catch((e: Error) => this.logger.warn(`Письмо об удалении ${userId}: ${e.message}`));
    return { deletedAt: now, eraseAt: eraseAt(now) };
  }

  /** Передумал в течение 30 дней: аккаунт снова открыт, снятые лоты — в архиве. */
  async restore(userId: string) {
    await this.prisma.user.updateMany({ where: { id: userId, erasedAt: null }, data: { deletedAt: null } });
  }

  @Interval('account-erase', SWEEP_MS)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.eraseDeleted();
      await this.eraseWithoutConsent();
    } catch (e) {
      this.logger.error(`Уничтожение данных: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  /** Удалённые больше 30 дней назад — уничтожить персональные данные. */
  async eraseDeleted(now = new Date()) {
    const due = await this.prisma.user.findMany({
      where: { deletedAt: { lte: new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS) }, erasedAt: null },
      select: { id: true },
      take: 100,
    });
    for (const u of due) await this.erase(u.id, now);
    return due.length;
  }

  /** Уничтожение: почта, вход, имя, «о себе», аватар, реквизиты, документы. */
  async erase(userId: string, now = new Date()) {
    const [profile, kyc] = await Promise.all([
      this.prisma.profile.findUnique({ where: { userId }, select: { avatarUrl: true } }),
      this.prisma.kycVerification.findMany({ where: { userId }, select: { documentRefs: true } }),
    ]);
    const name = erasedUsername(userId);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: {
          email: null,
          emailVerified: null,
          phone: null,
          passwordHash: null,
          telegramId: null,
          notifyPrefs: Prisma.DbNull,
          erasedAt: now,
        },
      }),
      this.prisma.profile.update({
        where: { userId },
        data: { username: name, displayName: name, bio: null, avatarUrl: null, greetingText: null, country: null },
      }),
      this.prisma.authSession.deleteMany({ where: { userId } }),
      this.prisma.socialAccount.deleteMany({ where: { userId } }),
      this.prisma.twoFactor.deleteMany({ where: { userId } }),
      this.prisma.pushSubscription.deleteMany({ where: { userId } }),
      this.prisma.payoutDestination.deleteMany({ where: { userId } }),
      this.prisma.replyTemplate.deleteMany({ where: { userId } }),
      this.prisma.emailChange.deleteMany({ where: { userId } }),
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.kycVerification.updateMany({ where: { userId }, data: { documentRefs: Prisma.DbNull, reason: null } }),
    ]);
    // Файлы — после записи в базе: упавшее хранилище не оставит аккаунт полустёртым.
    const keys = [
      profile?.avatarUrl,
      ...kyc.flatMap((k) => fileKeys(k.documentRefs)),
    ].filter((k): k is string => !!k && !/^https?:/.test(k));
    for (const key of keys) await this.storage.remove(key).catch(() => undefined);
    await this.retention
      ?.record('account_deleted', { userId, categories: ['contacts', 'login', 'profile', 'payout', 'kyc', 'notifications'] }, now)
      .catch((e) => this.logger.warn(`Журнал уничтожения: ${(e as Error).message}`));
  }

  /**
   * Отозвал согласие и не дал снова за 30 дней — уничтожить то, что было
   * только по согласию. Сделки, деньги и вход по договору остаются.
   */
  async eraseWithoutConsent(now = new Date()) {
    const due = await this.prisma.personalDataConsent.findMany({
      where: {
        revokedAt: { lte: new Date(now.getTime() - CONSENT_ERASE_DAYS * DAY_MS) },
        erasedAt: null,
        user: { consents: { none: { revokedAt: null } }, erasedAt: null },
      },
      select: { id: true, userId: true },
      take: 200,
    });
    const users = [...new Set(due.map((d) => d.userId))];
    for (const userId of users) {
      const profile = await this.prisma.profile.findUnique({ where: { userId }, select: { avatarUrl: true, username: true } });
      await this.prisma.$transaction([
        this.prisma.profile.update({
          where: { userId },
          data: { displayName: profile?.username ?? erasedUsername(userId), bio: null, avatarUrl: null, country: null },
        }),
        // Адрес и браузер — только у завершённых входов: действующие нужны для защиты аккаунта.
        this.prisma.authSession.deleteMany({ where: { userId, revokedAt: { not: null } } }),
        this.prisma.pushSubscription.deleteMany({ where: { userId } }),
        this.prisma.savedSearch.deleteMany({ where: { userId } }),
        this.prisma.stockWatch.deleteMany({ where: { userId } }),
        this.prisma.sellerFollow.deleteMany({ where: { userId } }),
        this.prisma.personalDataConsent.updateMany({
          where: { userId, revokedAt: { not: null }, erasedAt: null },
          data: { erasedAt: now },
        }),
      ]);
      const avatar = profile?.avatarUrl;
      if (avatar && !/^https?:/.test(avatar)) await this.storage.remove(avatar).catch(() => undefined);
      await this.retention
        ?.record('consent_revoked', { userId, subject: `${profile?.username ?? erasedUsername(userId)} (id ${userId})`, categories: ['profile', 'login', 'notifications', 'interests'] }, now)
        .catch((e) => this.logger.warn(`Журнал уничтожения: ${(e as Error).message}`));
    }
    return users.length;
  }
}

/** Ключи файлов проверки личности: { keys: [...], selfie: '...' }. */
function fileKeys(refs: unknown): string[] {
  if (!refs || typeof refs !== 'object') return [];
  const r = refs as { keys?: unknown; selfie?: unknown };
  return [...(Array.isArray(r.keys) ? r.keys : []), r.selfie].filter((k): k is string => typeof k === 'string');
}
