import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  createListingSchema,
  listingQuerySchema,
  updateListingSchema,
  type CreateListingInput,
  type ListingQuery,
  type UpdateListingInput,
} from '@gamemarket/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { ListingsService } from './listings.service';

const uploadSchema = z.object({ mime: z.string().min(3).max(100) });

@Controller('listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

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

  /** Presigned PUT для загрузки изображения лота. */
  @Post('uploads')
  @UseGuards(JwtAuthGuard)
  upload(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(uploadSchema)) body: { mime: string },
  ) {
    return this.listings.requestImageUpload(user.userId, body.mime);
  }

  @Get(':id')
  byId(@Param('id') id: string) {
    return this.listings.getById(id);
  }

  // ── Продавец (защищено) ──
  @Post()
  @UseGuards(JwtAuthGuard)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createListingSchema)) body: CreateListingInput,
  ) {
    return this.listings.create(user.userId, body);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateListingSchema)) body: UpdateListingInput,
  ) {
    return this.listings.update(user.userId, id, body);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.listings.remove(user.userId, id);
  }
}
