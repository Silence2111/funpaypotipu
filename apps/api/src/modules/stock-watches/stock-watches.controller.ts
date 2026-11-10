import { Controller, Delete, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { StockWatchesService } from './stock-watches.service';

@Controller('stock-watches')
@UseGuards(JwtAuthGuard)
export class StockWatchesController {
  constructor(private readonly watches: StockWatchesService) {}

  /** Ждёт ли человек этот лот — для кнопки на странице лота. */
  @Get(':listingId')
  status(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.watches.status(user.userId, listingId);
  }

  @Post(':listingId')
  watch(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.watches.watch(user.userId, listingId);
  }

  @Delete(':listingId')
  unwatch(@CurrentUser() user: AuthUser, @Param('listingId', ParseUUIDPipe) listingId: string) {
    return this.watches.unwatch(user.userId, listingId);
  }
}
