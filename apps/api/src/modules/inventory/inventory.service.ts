import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';

@Injectable()
export class InventoryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  /** Загрузка ключей/кодов на склад авто-лота. Хранятся зашифрованными. */
  async addKeys(sellerId: string, listingId: string, keys: string[]) {
    const listing = await this.ownedAutoListing(sellerId, listingId);

    await this.prisma.$transaction([
      this.prisma.digitalGood.createMany({
        data: keys.map((k) => ({ listingId: listing.id, payloadEnc: this.encryption.encrypt(k) })),
      }),
      this.prisma.listing.update({
        where: { id: listing.id },
        data: { stock: { increment: keys.length } },
      }),
    ]);
    return { added: keys.length };
  }

  async stock(sellerId: string, listingId: string) {
    await this.ownedAutoListing(sellerId, listingId);
    const grouped = await this.prisma.digitalGood.groupBy({
      by: ['status'],
      where: { listingId },
      _count: { _all: true },
    });
    const counts: Record<string, number> = { available: 0, reserved: 0, delivered: 0, revoked: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    return counts;
  }

  async removeKey(sellerId: string, goodId: string) {
    const good = await this.prisma.digitalGood.findUnique({
      where: { id: goodId },
      include: { listing: { select: { sellerId: true } } },
    });
    if (!good) throw new NotFoundException('Ключ не найден');
    if (good.listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш склад');
    if (good.status !== 'available') throw new BadRequestException('Ключ уже зарезервирован или выдан');

    await this.prisma.$transaction([
      this.prisma.digitalGood.delete({ where: { id: goodId } }),
      this.prisma.listing.update({ where: { id: good.listingId }, data: { stock: { decrement: 1 } } }),
    ]);
    return { ok: true };
  }

  private async ownedAutoListing(sellerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    if (listing.fulfillmentType !== 'auto_key') {
      throw new BadRequestException('Склад ключей доступен только для авто-лотов');
    }
    return listing;
  }
}
