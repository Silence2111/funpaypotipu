import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
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
  constructor(private readonly promo: PromoService) {}

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
