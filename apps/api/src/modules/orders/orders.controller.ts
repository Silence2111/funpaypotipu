import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { OrdersService } from './orders.service';

const createOrderSchema = z.object({ listingId: z.string().uuid() });

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: { listingId: string },
  ) {
    return this.orders.create(user.userId, body.listingId);
  }

  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.orders.listMine(user.userId);
  }

  @Get(':id')
  byId(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.getForUser(id, user.userId);
  }

  @Get(':id/key')
  key(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.revealKey(id, user.userId);
  }

  @Post(':id/deliver')
  deliver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.markDelivered(id, user.userId);
  }

  @Post(':id/confirm')
  confirm(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.confirm(id, user.userId);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.orders.cancel(id, user.userId);
  }
}
