import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { FavoritesService } from './favorites.service';

const addSchema = z.object({ listingId: z.string().uuid() });

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favorites: FavoritesService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.favorites.listMine(user.userId);
  }

  @Post()
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(addSchema)) body: { listingId: string },
  ) {
    return this.favorites.add(user.userId, body.listingId);
  }

  @Delete(':listingId')
  remove(@CurrentUser() user: AuthUser, @Param('listingId') listingId: string) {
    return this.favorites.remove(user.userId, listingId);
  }
}
