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

  /**
   * Загрузка на склад авто-лота: ключи, коды, аккаунты «логин:пароль»,
   * ссылки — по одной штуке в строке. Хранятся зашифрованными.
   */
  async addKeys(sellerId: string, listingId: string, keys: string[]) {
    const listing = await this.ownedAutoListing(sellerId, listingId);
    // Одна строка дважды — один аккаунт двум покупателям. Повторы в загрузке,
    // уже лежащее на складе и уже выданное пропускаются.
    const stored = await this.prisma.digitalGood.findMany({
      where: { listingId: listing.id, status: { in: ['available', 'reserved', 'delivered'] } },
      select: { payloadEnc: true },
    });
    const seen = new Set(stored.map((g) => this.encryption.decrypt(g.payloadEnc)));
    const fresh = [...new Set(keys.map((k) => k.trim()).filter(Boolean))].filter((k) => !seen.has(k));
    const skipped = keys.length - fresh.length;
    if (!fresh.length) return { added: 0, skipped };

    await this.prisma.$transaction([
      this.prisma.digitalGood.createMany({
        data: fresh.map((k) => ({ listingId: listing.id, payloadEnc: this.encryption.encrypt(k) })),
      }),
      this.prisma.listing.update({
        where: { id: listing.id },
        // Склад пополнился — распроданный лот снова в продаже.
        data: {
          stock: { increment: fresh.length },
          ...(listing.status === 'sold_out' ? { status: 'active' as const } : {}),
        },
      }),
    ]);
    return { added: fresh.length, skipped };
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
    if (!good) throw new NotFoundException('На складе такого нет');
    if (good.listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш склад');
    if (good.status !== 'available') throw new BadRequestException('Уже зарезервировано или выдано покупателю');

    await this.prisma.$transaction([
      this.prisma.digitalGood.delete({ where: { id: goodId } }),
      this.prisma.listing.update({ where: { id: good.listingId }, data: { stock: { decrement: 1 } } }),
      // Со склада убрано последнее — лот уходит из каталога, как после продажи.
      this.prisma.listing.updateMany({
        where: { id: good.listingId, stock: { lte: 0 }, status: 'active' },
        data: { status: 'sold_out' },
      }),
    ]);
    return { ok: true };
  }

  private async ownedAutoListing(sellerId: string, listingId: string) {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('Лот не найден');
    if (listing.sellerId !== sellerId) throw new ForbiddenException('Это не ваш лот');
    if (listing.fulfillmentType !== 'auto_key') {
      throw new BadRequestException('Склад есть только у лотов с автовыдачей');
    }
    return listing;
  }
}
