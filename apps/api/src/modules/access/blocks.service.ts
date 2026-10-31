import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

const STAFF_ROLES = ['agent', 'moderator', 'finance', 'admin'];

/**
 * Чёрный список, как на FunPay: тот, кого добавили, не пишет и не покупает.
 * Переписка по уже оплаченному заказу не закрывается — сделку надо довести.
 */
@Injectable()
export class BlocksService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  /** Можно ли `fromId` написать `toId` или купить у него. */
  async assertCanContact(fromId: string, toId: string, action: 'message' | 'buy'): Promise<void> {
    const rows = await this.prisma.userBlock.findMany({
      where: {
        OR: [
          { blockerId: fromId, blockedId: toId },
          { blockerId: toId, blockedId: fromId },
        ],
      },
      select: { blockerId: true },
    });
    if (rows.some((r) => r.blockerId === toId)) {
      throw new ForbiddenException(
        action === 'buy' ? 'Продавец ограничил вам покупки' : 'Пользователь ограничил переписку с вами',
      );
    }
    if (rows.some((r) => r.blockerId === fromId)) {
      throw new ForbiddenException('Пользователь в вашем чёрном списке — уберите его оттуда, чтобы продолжить');
    }
  }

  /** Купить лот можно, если продавец не закрылся от покупателя и наоборот. */
  async assertCanBuy(buyerId: string, listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, select: { sellerId: true } });
    if (listing) await this.assertCanContact(buyerId, listing.sellerId, 'buy');
  }

  async list(userId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: userId },
      orderBy: { createdAt: 'desc' },
      select: { blockedId: true, createdAt: true, blocked: { select: { profile: { select: { username: true } } } } },
    });
    return rows.map((r) => ({ userId: r.blockedId, username: r.blocked.profile?.username ?? null, createdAt: r.createdAt }));
  }

  async add(userId: string, targetId: string) {
    if (userId === targetId) throw new BadRequestException('Себя в чёрный список не добавить');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { id: true, roles: { select: { role: { select: { key: true } } } } },
    });
    if (!target) throw new NotFoundException('Пользователь не найден');
    // От арбитра и модератора не закрыться: иначе спор или проверку не довести.
    if (target.roles.some((r) => STAFF_ROLES.includes(r.role.key))) {
      throw new BadRequestException('Сотрудника площадки в чёрный список не добавить');
    }
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: userId, blockedId: targetId } },
      update: {},
      create: { blockerId: userId, blockedId: targetId },
    });
    return { ok: true };
  }

  async remove(userId: string, targetId: string) {
    await this.prisma.userBlock.deleteMany({ where: { blockerId: userId, blockedId: targetId } });
    return { ok: true };
  }
}
