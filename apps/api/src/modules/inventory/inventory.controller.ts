import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { InventoryService } from './inventory.service';

const keysSchema = z.object({ keys: z.array(z.string().min(1)).min(1).max(1000) });

@Controller()
@UseGuards(JwtAuthGuard)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('listings/:id/keys')
  add(
    @CurrentUser() user: AuthUser,
    @Param('id') listingId: string,
    @Body(new ZodValidationPipe(keysSchema)) body: { keys: string[] },
  ) {
    return this.inventory.addKeys(user.userId, listingId, body.keys);
  }

  @Get('listings/:id/keys/stock')
  stock(@CurrentUser() user: AuthUser, @Param('id') listingId: string) {
    return this.inventory.stock(user.userId, listingId);
  }

  @Delete('keys/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.inventory.removeKey(user.userId, id);
  }
}
