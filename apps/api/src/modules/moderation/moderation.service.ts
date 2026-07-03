import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient, type ListingStatus, type ReportStatus, type UserStatus } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { AuditService } from '../access/audit.service';

@Injectable()
export class ModerationService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  // ── Жалобы (любой пользователь) ──
  createReport(reporterId: string, targetType: string, targetId: string, reason: string, details?: string) {
    return this.prisma.report.create({
      data: { reporterId, targetType, targetId, reason, details, status: 'open' },
    });
  }

  // ── Очередь и обработка (модератор) ──
  listReports(status?: ReportStatus) {
    return this.prisma.report.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'asc' },
    });
  }

  async handleReport(reportId: string, staffId: string, status: ReportStatus) {
    const report = await this.prisma.report.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Жалоба не найдена');
    const updated = await this.prisma.report.update({
      where: { id: reportId },
      data: { status, handledBy: staffId },
    });
    await this.audit.log({
      actorId: staffId,
      action: `report.${status}`,
      entityType: 'report',
      entityId: reportId,
    });
    return updated;
  }

  // ── Действия над лотами ──
  async setListingStatus(staffId: string, listingId: string, status: ListingStatus, reason?: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Лот не найден');
    const updated = await this.prisma.listing.update({ where: { id: listingId }, data: { status } });
    await this.record(staffId, 'listing', listingId, status === 'blocked' ? 'block' : 'unblock', reason);
    return updated;
  }

  // ── Действия над пользователями ──
  async setUserStatus(staffId: string, userId: string, status: UserStatus, reason?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Пользователь не найден');
    const updated = await this.prisma.user.update({ where: { id: userId }, data: { status } });
    const action = status === 'banned' ? 'ban' : status === 'frozen' ? 'block' : 'unblock';
    await this.record(staffId, 'user', userId, action, reason);
    return { id: updated.id, status: updated.status };
  }

  private async record(
    actorId: string,
    targetType: string,
    targetId: string,
    action: 'warn' | 'block' | 'unblock' | 'ban' | 'hide' | 'delete',
    reason?: string,
  ) {
    await this.prisma.moderationAction.create({
      data: { actorId, targetType, targetId, action, reason },
    });
    await this.audit.log({ actorId, action: `moderation.${action}`, entityType: targetType, entityId: targetId });
  }
}
