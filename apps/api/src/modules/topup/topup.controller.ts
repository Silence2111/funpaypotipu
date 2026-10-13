import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { TopupService } from './topup.service';

const offersQuery = z.object({
  game: z.string().regex(/^[a-z0-9-]{1,64}$/),
});

/** Публичное: виджет пополнения на главной и на странице лота. */
@Controller('topup')
export class TopupController {
  constructor(private readonly topup: TopupService) {}

  @Get('offers')
  offers(@Query(new ZodValidationPipe(offersQuery)) q: { game: string }) {
    return this.topup.offers(q.game);
  }
}
