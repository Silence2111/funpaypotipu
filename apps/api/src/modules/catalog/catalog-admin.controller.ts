import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { RolesGuard } from '../access/roles.guard';
import { Roles } from '../access/roles.decorator';
import {
  ATTRIBUTE_TYPES,
  CatalogAdminService,
  type AttributeInput,
  type CategoryInput,
  type GameInput,
} from './catalog-admin.service';

/** Адрес в ссылке: латиница, цифры, дефис — «cs2», «genshin-impact». */
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Адрес — латиница, цифры и дефис')
  .max(40);
const title = z.string().trim().min(2, 'Название — от 2 символов').max(80);
const aliases = z.array(z.string().trim().min(1).max(40)).max(30);
const GAME_KINDS = ['game', 'mobile', 'app'] as const;
const SEGMENTS = ['accounts', 'currency', 'items', 'service', 'key', 'topup'] as const;
const FULFILLMENT = ['manual', 'auto_key', 'provider'] as const;

const gameCreate = z.object({
  slug,
  title,
  kind: z.enum(GAME_KINDS),
  aliases: aliases.optional(),
  sortOrder: z.number().int().min(1).max(100).optional(),
});
const gameUpdate = z.object({
  title: title.optional(),
  kind: z.enum(GAME_KINDS).optional(),
  aliases: aliases.optional(),
  sortOrder: z.number().int().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
});
const unit = {
  unitName: z.string().trim().max(20).nullable().optional(),
  pricePerUnits: z.number().int().min(1).max(1_000_000).nullable().optional(),
};
const categoryCreate = z.object({
  slug,
  title,
  segment: z.enum(SEGMENTS),
  fulfillmentType: z.enum(FULFILLMENT),
  ...unit,
});
const categoryUpdate = z.object({
  title: title.optional(),
  segment: z.enum(SEGMENTS).optional(),
  fulfillmentType: z.enum(FULFILLMENT).optional(),
  isActive: z.boolean().optional(),
  ...unit,
});
const options = z.array(z.string().trim().min(1).max(60)).max(50);
const attributeCreate = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{0,29}$/, 'Ключ поля — латиница, цифры и «_», с буквы'),
  label: z.string().trim().min(2, 'Подпись — от 2 символов').max(60),
  type: z.enum(ATTRIBUTE_TYPES),
  options: options.optional(),
  isRequired: z.boolean().optional(),
  isFilter: z.boolean().optional(),
});
const attributeUpdate = z.object({
  label: z.string().trim().min(2, 'Подпись — от 2 символов').max(60).optional(),
  options: options.optional(),
  isRequired: z.boolean().optional(),
  isFilter: z.boolean().optional(),
});
const order = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) });

/**
 * Каталог в консоли — только администратору. Всё пишется в журнал
 * (раздел «Каталог»), изменённое здесь сид при выкате не трогает.
 */
@Controller('admin/catalog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class CatalogAdminController {
  constructor(private readonly catalog: CatalogAdminService) {}

  @Get()
  tree() {
    return this.catalog.tree();
  }

  @Post('games')
  createGame(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(gameCreate)) body: GameInput) {
    return this.catalog.createGame(u.userId, body);
  }

  @Patch('games/:id')
  updateGame(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(gameUpdate)) body: z.infer<typeof gameUpdate>,
  ) {
    return this.catalog.updateGame(u.userId, id, body);
  }

  @Post('games/:id/cover')
  @UseInterceptors(FileInterceptor('file'))
  cover(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined,
  ) {
    return this.catalog.setCover(u.userId, id, file);
  }

  @Post('games/:id/categories')
  createCategory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) gameId: string,
    @Body(new ZodValidationPipe(categoryCreate)) body: CategoryInput,
  ) {
    return this.catalog.createCategory(u.userId, gameId, body);
  }

  @Put('games/:id/categories/order')
  orderCategories(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) gameId: string,
    @Body(new ZodValidationPipe(order)) body: { ids: string[] },
  ) {
    return this.catalog.orderCategories(u.userId, gameId, body.ids);
  }

  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(categoryUpdate)) body: z.infer<typeof categoryUpdate>,
  ) {
    return this.catalog.updateCategory(u.userId, id, body);
  }

  @Post('categories/:id/attributes')
  createAttribute(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) categoryId: string,
    @Body(new ZodValidationPipe(attributeCreate)) body: AttributeInput,
  ) {
    return this.catalog.createAttribute(u.userId, categoryId, body);
  }

  @Put('categories/:id/attributes/order')
  orderAttributes(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) categoryId: string,
    @Body(new ZodValidationPipe(order)) body: { ids: string[] },
  ) {
    return this.catalog.orderAttributes(u.userId, categoryId, body.ids);
  }

  @Patch('attributes/:id')
  updateAttribute(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(attributeUpdate)) body: z.infer<typeof attributeUpdate>,
  ) {
    return this.catalog.updateAttribute(u.userId, id, body);
  }

  @Delete('attributes/:id')
  deleteAttribute(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.deleteAttribute(u.userId, id);
  }
}
