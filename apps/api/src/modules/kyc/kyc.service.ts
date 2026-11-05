import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { SAFE_KEY, StorageService } from '../storage/storage.service';
import { AuditService } from '../access/audit.service';
import { ScanService } from '../antivirus/scan.service';
import { NotificationsService } from '../notifications/notifications.service';
import { containsText } from '../../common/like';
import { nextCursor } from '../../common/cursor';

export const KYC_QUEUE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type KycQueueStatus = (typeof KYC_QUEUE_STATUSES)[number];

/** Страница очереди проверки: какие, что искать, с какой заявки продолжать. */
export interface KycQueueQuery {
  status?: KycQueueStatus;
  q?: string;
  /** Из `next` прошлой страницы: время (подачи или решения) и id последней показанной. */
  cursor?: { at: Date; id: string };
  limit?: number;
}

/** Документ и селфи — фото или PDF скана. */
const KYC_TYPES: Record<string, string> = {
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

/**
 * Проверка личности продавца: фото документа и селфи с ним. После проверки —
 * вывод без ограничения суммы и «Документы проверены» в профиле. Документы
 * видит только сотрудник проверки — по ссылкам на час; наружу хранилище
 * их не отдаёт.
 */
@Injectable()
export class KycService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly scanner: ScanService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Подписанная ссылка на загрузку файла заявки. */
  async requestUpload(userId: string, mime: string) {
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = KYC_TYPES[mime];
    if (!ext) throw new BadRequestException('Подойдёт фото (JPG, PNG, WebP, HEIC) или PDF');
    const key = `kyc/${userId}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  /**
   * Заявка: фото документа (разворот, при необходимости — второе) и селфи с
   * ним. Файлы — только загруженные этим пользователем и прошедшие
   * антивирус; вторая заявка, пока первая на проверке, не принимается.
   */
  async submit(userId: string, documentKeys: string[], selfieKey: string) {
    const own = (k: string) =>
      k.startsWith(`kyc/${userId}/`) && SAFE_KEY.test(k) && !k.includes('..');
    const files = [...documentKeys, selfieKey];
    if (!files.every(own))
      throw new BadRequestException('Файлы не из этой заявки — загрузите их заново');
    if (new Set(files).size !== files.length)
      throw new BadRequestException('Одно и то же фото дважды');
    const last = await this.mine(userId);
    if (last.status === 'pending') throw new ConflictException('Документы уже на проверке');
    if (last.status === 'approved') throw new ConflictException('Документы уже проверены');
    for (const key of files) await this.scan(key);
    await this.prisma.kycVerification.create({
      data: {
        userId,
        level: 'document',
        status: 'pending',
        documentRefs: { keys: documentKeys, selfie: selfieKey } as Prisma.InputJsonValue,
      },
    });
    return this.mine(userId);
  }

  private async scan(key: string) {
    const bytes = await this.storage.getBytes(key).catch(() => null);
    if (!bytes) throw new BadRequestException('Файл не загрузился — добавьте его ещё раз');
    const result = await this.scanner.scan(bytes);
    if (!result.clean) {
      await this.storage.remove(key);
      throw new BadRequestException(`Файл не прошёл антивирус-проверку: ${result.reason}`);
    }
  }

  /** Последняя заявка пользователя: статус и, если не приняли, — почему. */
  async mine(userId: string) {
    const last = await this.prisma.kycVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        level: true,
        status: true,
        reason: true,
        reviewedAt: true,
        createdAt: true,
      },
    });
    return last ?? { level: 'none' as const, status: 'none' as const };
  }

  // ── Сотрудник проверки ──

  /**
   * Очередь заявок с документами — по страницам. Ждущие — от старых к новым;
   * одобренные и отклонённые — свежие решения сверху, с причиной и тем, кто
   * решал. Поиск — по нику, имени и почте; счётчики по статусам. Раньше
   * отдавались все ждущие разом — и ссылки на документы для каждой: при
   * наплыве заявок страница грузила сотни фото, а решённых заявок и поиска
   * не было вовсе.
   */
  async queue(q: KycQueueQuery = {}) {
    const status = q.status ?? 'pending';
    const pending = status === 'pending';
    const limit = q.limit ?? 50;
    const text = q.q?.trim().replace(/^[#@]+/, '');
    // Заявок на проверку мало — поиск обычным условием.
    const match: Prisma.KycVerificationWhereInput = text
      ? {
          OR: [
            { user: { email: containsText(text) } },
            { user: { profile: { username: containsText(text) } } },
            { user: { profile: { displayName: containsText(text) } } },
          ],
        }
      : {};
    const c = q.cursor;
    const after: Prisma.KycVerificationWhereInput = !c
      ? {}
      : pending
        ? { OR: [{ createdAt: { gt: c.at } }, { createdAt: c.at, id: { gt: c.id } }] }
        : { OR: [{ reviewedAt: { lt: c.at } }, { reviewedAt: c.at, id: { lt: c.id } }] };
    const [page, grouped] = await Promise.all([
      this.prisma.kycVerification.findMany({
        where: { status, AND: [match, after] },
        orderBy: pending
          ? [{ createdAt: 'asc' }, { id: 'asc' }]
          : [{ reviewedAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: limit + 1,
        include: {
          user: {
            select: {
              email: true,
              createdAt: true,
              profile: { select: { username: true, displayName: true, salesCount: true } },
            },
          },
        },
      }),
      this.prisma.kycVerification.groupBy({ by: ['status'], where: match, _count: { _all: true } }),
    ]);
    const rows = page.slice(0, limit);
    const reviewers = new Map(
      (
        await this.prisma.profile.findMany({
          where: { userId: { in: [...new Set(rows.map((k) => k.reviewedBy).filter((v): v is string => !!v))] } },
          select: { userId: true, username: true },
        })
      ).map((p) => [p.userId, p.username]),
    );
    const items = await Promise.all(
      rows.map(async (k) => {
        const refs = (k.documentRefs ?? {}) as Refs;
        const files = [
          ...(refs.keys ?? []).map((key) => ({ key, kind: 'document' as const })),
          ...(refs.selfie ? [{ key: refs.selfie, kind: 'selfie' as const }] : []),
        ];
        return {
          id: k.id,
          userId: k.userId,
          level: k.level,
          status: k.status,
          reason: k.reason,
          createdAt: k.createdAt,
          reviewedAt: k.reviewedAt,
          reviewer: k.reviewedBy ? (reviewers.get(k.reviewedBy) ?? null) : null,
          user: {
            username: k.user.profile?.username ?? null,
            displayName: k.user.profile?.displayName ?? null,
            email: k.user.email,
            since: k.user.createdAt,
            sales: k.user.profile?.salesCount ?? 0,
          },
          // Ссылки на документы — только этой страницы, на час.
          files: await Promise.all(
            files.map(async (f) => ({
              kind: f.kind,
              pdf: f.key.endsWith('.pdf'),
              url: await this.storage.presignGet(f.key, 3600),
            })),
          ),
        };
      }),
    );
    const count = (s: KycQueueStatus) => grouped.find((g) => g.status === s)?._count._all ?? 0;
    const last = rows[rows.length - 1];
    const next =
      page.length > limit && last
        ? nextCursor(pending ? last.createdAt : (last.reviewedAt ?? last.createdAt), last.id)
        : null;
    return {
      items,
      next,
      counts: { pending: count('pending'), approved: count('approved'), rejected: count('rejected') },
    };
  }

  async review(id: string, reviewerId: string, decision: 'approve' | 'reject', reason?: string) {
    const note = reason?.trim();
    if (decision === 'reject' && !note) {
      throw new BadRequestException('Напишите, что не так: продавец увидит причину и переснимет');
    }
    const kyc = await this.prisma.kycVerification.findUnique({ where: { id } });
    if (!kyc) throw new NotFoundException('Заявка не найдена');
    if (kyc.status !== 'pending') throw new ForbiddenException('Заявка уже обработана');

    const updated = await this.prisma.kycVerification.update({
      where: { id },
      data: {
        status: decision === 'approve' ? 'approved' : 'rejected',
        reason: decision === 'reject' ? note : null,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      },
    });
    await this.audit.log({
      actorId: reviewerId,
      action: `kyc.${decision}`,
      entityType: 'kyc',
      entityId: id,
    });
    await this.notifications.notify(
      kyc.userId,
      decision === 'approve' ? 'kyc_approved' : 'kyc_rejected',
      decision === 'reject' ? { reason: note } : {},
    );
    return { id: updated.id, status: updated.status };
  }
}
