import { Controller, Get, Param } from '@nestjs/common';
import { SellersService } from './sellers.service';

@Controller('sellers')
export class SellersController {
  constructor(private readonly sellers: SellersService) {}

  /** Публичная витрина продавца. */
  @Get(':id')
  profile(@Param('id') id: string) {
    return this.sellers.publicProfile(id);
  }
}
