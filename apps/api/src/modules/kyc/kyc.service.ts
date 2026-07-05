import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type KycLevel } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../access/audit.service';

@Injectable()
export class KycService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** Presigned PUT для загрузки документа верификации. */
  async requestUpload(userId: string, mime: string) {
    if (!this.storage.enabled) throw new NotFoundException('Хранилище недоступно');
    const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
    const key = `kyc/${userId}/${randomUUID()}.${ext}`;
    return { key, uploadUrl: await this.storage.presignPut(key) };
  }

  /** Подать заявку на верификацию (документы — ключи из S3). */
  submit(userId: string, level: KycLevel, documentKeys: string[]) {
    return this.prisma.kycVerification.create({
      data: {
        userId,
        level,
        status: 'pending',
        documentRefs: { keys: documentKeys } as Prisma.InputJsonValue,
      },
    });
  }

  /** Последний статус верификации пользователя. */
  async mine(userId: string) {
    const last = await this.prisma.kycVerification.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, level: true, status: true, reviewedAt: true, createdAt: true },
    });
    return last ?? { level: 'none', status: 'none' };
  }

  // ── Модератор ──
  pending() {
    return this.prisma.kycVerification.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async review(id: string, reviewerId: string, decision: 'approve' | 'reject') {
    const kyc = await this.prisma.kycVerification.findUnique({ where: { id } });
    if (!kyc) throw new NotFoundException('Заявка не найдена');
    if (kyc.status !== 'pending') throw new ForbiddenException('Заявка уже обработана');

    const updated = await this.prisma.kycVerification.update({
      where: { id },
      data: {
        status: decision === 'approve' ? 'approved' : 'rejected',
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
    return { id: updated.id, status: updated.status };
  }
}
