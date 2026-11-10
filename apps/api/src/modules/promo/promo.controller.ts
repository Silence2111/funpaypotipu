import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { TokenService } from '../auth/token.service';
import { SellerPromosService } from './seller-promos.service';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import { PromoService, type PromoInput } from './promo.service';

const createSchema = z.object({
  code: z.string().min(3).max(32),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().positive(),
  maxUses: z.number().int().positive().optional(),
  validUntil: z.string().datetime().optional(),
});

@Controller('promo')
export class PromoController {
  constructor(
    private readonly promo: PromoService,
    private readonly sellerPromos: SellerPromosService,
    private readonly tokens: TokenService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
  ) {}

  /**
   * «Применить» в панели покупки: сначала код продавца этого лота (скидка
   * за его счёт, видна в цене сразу), потом код площадки (скидка — при
   * оплате, с потолком по комиссии). Вход не обязателен; с ним проверяется
   * и «один раз на покупателя», и «только постоянным».
   */
  @Get('check')
  async check(
    @Query('code') code: string | undefined,
    @Query('listingId') listingId: string | undefined,
    @Req() req: Request,
  ) {
    if (!code?.trim()) throw new NotFoundException('Промокод недействителен');
    const listing =
      listingId && /^[0-9a-f-]{36}$/i.test(listingId)
        ? await this.prisma.listing.findUnique({
            where: { id: listingId },
            select: { sellerId: true, topupMarkupBps: true },
          })
        : null;
    if (listing) {
      let buyerId: string | null = null;
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        try {
          buyerId = this.tokens.verifyAccess(header.slice(7)).sub;
        } catch {
          buyerId = null;
        }
      }
      const own = await this.sellerPromos.check(code, listing, buyerId);
      if (own) return { source: 'seller', code: own.code, percent: own.percent };
    }
    const p = await this.promo.preview(code.trim().toUpperCase());
    return { source: 'platform', ...p };
  }

  @Get(':code')
  preview(@Param('code') code: string) {
    return this.promo.preview(code.toUpperCase());
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  create(@Body(new ZodValidationPipe(createSchema)) body: PromoInput) {
    return this.promo.create(body);
  }

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin')
  list() {
    return this.promo.list();
  }
}
