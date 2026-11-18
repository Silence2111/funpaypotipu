import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

/** Сообщений в выгрузке — не больше стольких последних: остальное — по запросу в поддержку. */
const MESSAGES_CAP = 10_000;

const titleOf = (snapshot: unknown) => (snapshot as { title?: string } | null)?.title ?? null;

/**
 * «Скачать мои данные» (уточнение к части 124, ст. 14 152-ФЗ — право
 * человека знать, какие его данные у площадки): профиль, согласия, входы,
 * заказы, лоты, свои сообщения и отзывы, обращения, выплаты, запросы —
 * одним файлом JSON. Реквизиты выплат — только способ, без номера:
 * файл может утечь с компьютера человека. Хеши паролей и секреты входа с
 * кодом не отдаются — это не данные человека, а наша защита.
 */
@Injectable()
export class ExportService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async export(userId: string, now = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        consents: { orderBy: { givenAt: 'asc' } },
        sessions: { orderBy: { createdAt: 'desc' }, take: 200 },
        socialAccounts: { select: { provider: true, email: true, name: true, createdAt: true } },
        twoFactor: { select: { enabledAt: true } },
      },
    });
    if (!user || user.deletedAt) throw new NotFoundException('Аккаунт не найден');

    const orderSelect = {
      publicNumber: true,
      listingSnapshot: true,
      amount: true,
      currency: true,
      qty: true,
      status: true,
      createdAt: true,
      paidAt: true,
      deliveredAt: true,
      completedAt: true,
    } as const;
    const [
      asBuyer,
      asSeller,
      listings,
      messages,
      written,
      received,
      tickets,
      payouts,
      destinations,
      payments,
      buyRequests,
    ] = await Promise.all([
      this.prisma.order.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        select: orderSelect,
      }),
      this.prisma.order.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        select: orderSelect,
      }),
      this.prisma.listing.findMany({
        where: { sellerId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          description: true,
          price: true,
          currency: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.message.findMany({
        where: { senderId: userId },
        orderBy: { createdAt: 'desc' },
        take: MESSAGES_CAP,
        select: { conversationId: true, body: true, createdAt: true },
      }),
      this.prisma.review.findMany({
        where: { authorId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          rating: true,
          comment: true,
          createdAt: true,
          editedAt: true,
          order: { select: { publicNumber: true } },
        },
      }),
      this.prisma.review.findMany({
        where: { targetId: userId },
        orderBy: { createdAt: 'desc' },
        select: {
          rating: true,
          comment: true,
          sellerReply: true,
          createdAt: true,
          order: { select: { publicNumber: true } },
        },
      }),
      this.prisma.supportTicket.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          subject: true,
          category: true,
          status: true,
          createdAt: true,
          messages: {
            orderBy: { createdAt: 'asc' },
            select: { fromStaff: true, body: true, createdAt: true },
          },
        },
      }),
      this.prisma.payout.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: {
          amount: true,
          currency: true,
          method: true,
          status: true,
          createdAt: true,
          rejectReason: true,
        },
      }),
      this.prisma.payoutDestination.findMany({
        where: { userId },
        select: { method: true, createdAt: true, lastUsedAt: true },
      }),
      this.prisma.payment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { amount: true, currency: true, method: true, status: true, createdAt: true },
      }),
      this.prisma.buyRequest.findMany({
        where: { buyerId: userId },
        orderBy: { createdAt: 'desc' },
        select: { text: true, maxPrice: true, status: true, createdAt: true, expiresAt: true },
      }),
    ]);
    const order = (o: (typeof asBuyer)[number]) => {
      const { listingSnapshot, ...rest } = o;
      return { ...rest, title: titleOf(listingSnapshot) };
    };
    const p = user.profile;
    return {
      generatedAt: now.toISOString(),
      about:
        'Данные вашего аккаунта на GameMarket на момент выгрузки. Суммы — в копейках. ' +
        'Реквизиты выплат не выгружаются — только способ. Хеши паролей и секреты входа с кодом — тоже: это защита аккаунта, а не ваши данные.',
      account: {
        id: user.id,
        email: user.email,
        emailVerifiedAt: user.emailVerified,
        phone: user.phone,
        phoneVerifiedAt: user.phoneVerifiedAt,
        locale: user.locale,
        status: user.status,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt,
        telegramLinked: !!user.telegramId,
        twoFactorEnabledAt: user.twoFactor?.enabledAt ?? null,
        socialAccounts: user.socialAccounts,
      },
      profile: p
        ? {
            username: p.username,
            displayName: p.displayName,
            bio: p.bio,
            country: p.country,
            avatarUrl: p.avatarUrl,
            steamTradeUrl: p.steamTradeUrl,
            greetingText: p.greetingText,
            ratingAvg: p.ratingAvg,
            ratingCount: p.ratingCount,
            salesCount: p.salesCount,
            createdAt: p.createdAt,
          }
        : null,
      consents: user.consents.map((c) => ({
        version: c.version,
        method: c.method,
        ip: c.ip,
        userAgent: c.userAgent,
        givenAt: c.givenAt,
        revokedAt: c.revokedAt,
      })),
      sessions: user.sessions.map((s) => ({
        createdAt: s.createdAt,
        ip: s.ip,
        userAgent: s.userAgent,
        expiresAt: s.expiresAt,
        revokedAt: s.revokedAt,
      })),
      orders: { asBuyer: asBuyer.map(order), asSeller: asSeller.map(order) },
      listings,
      messages: {
        count: messages.length,
        limitedTo: messages.length === MESSAGES_CAP ? MESSAGES_CAP : null,
        items: messages,
      },
      reviews: {
        written: written.map(({ order: o, ...r }) => ({ ...r, order: o?.publicNumber ?? null })),
        received: received.map(({ order: o, ...r }) => ({ ...r, order: o?.publicNumber ?? null })),
      },
      supportTickets: tickets,
      payments,
      payouts,
      payoutDestinations: destinations,
      buyRequests,
    };
  }
}
