import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { SavedSearchesService, type SearchInput } from './saved-searches.service';

/** Цена — в копейках, до 10 млн ₽: больше лотов не бывает. */
const maxPrice = z
  .number()
  .int()
  .positive('Цена — больше нуля')
  .max(1_000_000_000, 'Цена — до 10 млн ₽')
  .nullish();

const createSchema = z.object({
  categoryId: z.string().uuid(),
  attrs: z.record(z.string(), z.union([z.string(), z.boolean()])).optional(),
  q: z.string().trim().max(100, 'Текст поиска — до 100 символов').nullish(),
  maxPrice,
  notify: z.boolean().optional(),
});
const updateSchema = z.object({ notify: z.boolean().optional(), maxPrice });

@Controller('saved-searches')
@UseGuards(JwtAuthGuard)
export class SavedSearchesController {
  constructor(private readonly searches: SavedSearchesService) {}

  /** «Мои поиски»: условия, подписи параметров и ссылка на раздел. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.searches.list(user.userId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSchema)) body: SearchInput,
  ) {
    return this.searches.create(user.userId, body);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateSchema)) body: { notify?: boolean; maxPrice?: number | null },
  ) {
    return this.searches.update(user.userId, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.searches.remove(user.userId, id);
  }
}
