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
   * Очередь заявок с документами. Раньше в очереди были только номер
   * пользователя и уровень: самих документов сотрудник не видел, и одобрить
   * или отклонить можно было только вслепую.
   */
  async pending() {
    const rows = await this.prisma.kycVerification.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            email: true,
            createdAt: true,
            profile: { select: { username: true, displayName: true, salesCount: true } },
          },
        },
      },
    });
    return Promise.all(
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
          createdAt: k.createdAt,
          user: {
            username: k.user.profile?.username ?? null,
            displayName: k.user.profile?.displayName ?? null,
            email: k.user.email,
            since: k.user.createdAt,
            sales: k.user.profile?.salesCount ?? 0,
          },
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
