import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import {
  createListingSchema,
  listingQuerySchema,
  updateListingSchema,
  type CreateListingInput,
  type ListingQuery,
  type UpdateListingInput,
} from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { AccountStatusService } from '../access/account-status.service';
import { ListingsService } from './listings.service';

const bumpAllSchema = z.object({ categoryId: z.string().uuid().optional() });
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['pause', 'activate', 'bump']),
});
const awaySchema = z.object({ away: z.boolean() });

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly account: AccountStatusService,
  ) {}

  // ── Публичное ──
  @Get()
  browse(@Query(new ZodValidationPipe(listingQuerySchema)) query: ListingQuery) {
    return this.listings.browse(query);
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.listMine(user.userId);
  }

  /** Свой лот для формы изменения — в любом статусе, кроме архива. */
  @Get('mine/:id')
  @UseGuards(JwtAuthGuard)
  mineOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.getMine(user.userId, id);
  }

  /** Поднять все активные лоты (или лоты одного раздела) разом. */
  @Post('bump-all')
  @UseGuards(JwtAuthGuard)
  bumpAll(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bumpAllSchema)) body: { categoryId?: string },
  ) {
    return this.listings.bumpAll(user.userId, { categoryId: body.categoryId });
  }

  /** Выбранные лоты разом: снять, вернуть в продажу, поднять. */
  @Post('bulk')
  @UseGuards(JwtAuthGuard)
  async bulk(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(bulkSchema)) body: { ids: string[]; action: 'pause' | 'activate' | 'bump' },
  ) {
    // Как и у одного лота: снять можно и в заморозке, вернуть в продажу — нет.
    if (body.action === 'activate') await this.account.assertCanTrade(user.userId);
    return this.listings.bulk(user.userId, [...new Set(body.ids)], body.action);
  }

  @Get('away')
  @UseGuards(JwtAuthGuard)
  away(@CurrentUser() user: AuthUser) {
    return this.listings.getAway(user.userId);
  }

  /** Отпуск: { away: true } — снять все лоты разом, { away: false } — вернуть их. */
  @Post('away')
  @UseGuards(JwtAuthGuard)
  async setAway(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(awaySchema)) body: { away: boolean }) {
    if (!body.away) await this.account.assertCanTrade(user.userId);
    return this.listings.setAway(user.userId, body.away);
  }

  /** Загрузка изображения лота (multipart через API; MinIO приватный). */
  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number },
  ) {
    return this.listings.uploadImage(user.userId, file);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.listings.getById(id);
  }

  // ── Продавец (защищено) ──
  @Post()
  @UseGuards(JwtAuthGuard)
  async create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createListingSchema)) body: CreateListingInput,
  ) {
    await this.account.assertCanTrade(user.userId);
    return this.listings.create(user.userId, body);
  }

  /** Продвинуть лот за деньги с баланса: 1, 3 или 7 суток. */
  @Post(':id/promote')
  @UseGuards(JwtAuthGuard)
  async promote(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(z.object({ days: z.union([z.literal(1), z.literal(3), z.literal(7)]) }))) body: { days: number },
  ) {
    await this.account.assertCanTrade(user.userId);
    return this.listings.promote(user.userId, id, body.days);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListingInput,
  ) {
    // Снять с продажи и поправить текст можно и в заморозке, вернуть в продажу — нет.
    if (body.status === 'active') await this.account.assertCanTrade(user.userId);
    return this.listings.update(user.userId, id, body);
  }

  @Post(':id/bump')
  @UseGuards(JwtAuthGuard)
  bump(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.bump(user.userId, id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.remove(user.userId, id);
  }
}
