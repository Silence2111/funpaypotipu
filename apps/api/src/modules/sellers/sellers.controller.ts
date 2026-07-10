import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { SellersService } from './sellers.service';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /** Аналитика собственного кабинета (перед :id, чтобы «me» не ушёл в параметр). */
  @Get('me/dashboard')
  @UseGuards(JwtAuthGuard)
  dashboard(@CurrentUser() user: AuthUser) {
    return this.sellers.dashboard(user.userId);
  }

  /** Публичная витрина продавца. */
  @Get(':id')
  profile(@Param('id') id: string) {
    return this.sellers.publicProfile(id);
  }
}
