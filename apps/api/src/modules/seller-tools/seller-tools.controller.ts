import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { COMMAND_MAX, BUYER_AGE_DAYS, BUYER_LOST_DISPUTES } from '@gamemarket/shared';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { SellerToolsService, type TemplateInput } from './seller-tools.service';

const greetingSchema = z.object({
  text: z.string().max(1000, 'Приветствие — до 1000 символов').nullable(),
});
const autoRaiseSchema = z.object({ on: z.boolean() });
const templateSchema = z.object({
  title: z.string().trim().min(1, 'Назовите заготовку').max(60, 'Название — до 60 символов'),
  body: z
    .string()
    .trim()
    .min(1, 'Текст заготовки пустой')
    .max(2000, 'Заготовка — до 2000 символов'),
  command: z
    .string()
    .trim()
    .max(COMMAND_MAX, `Команда — до ${COMMAND_MAX} символов`)
    .regex(/^[^\n\r]*$/, 'Команда — в одну строку')
    .nullish(),
});

const buyerFilterSchema = z.object({
  minAgeDays: z.number().int().refine((d) => (BUYER_AGE_DAYS as readonly number[]).includes(d), 'Возраст аккаунта — 0, 1, 7 или 30 дней'),
  maxLostDisputes: z
    .number()
    .int()
    .refine((d) => (BUYER_LOST_DISPUTES as readonly number[]).includes(d), 'Проигранных споров — 0, 1 или 3')
    .nullable(),
  noBadReviews: z.boolean(),
});

@Controller('seller-tools')
@UseGuards(JwtAuthGuard)
export class SellerToolsController {
  constructor(private readonly tools: SellerToolsService) {}

  /** Всё разом для страницы «Инструменты»: приветствие, автоподнятие, заготовки. */
  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.tools.get(user.userId);
  }

  @Put('greeting')
  greeting(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(greetingSchema)) body: { text: string | null },
  ) {
    return this.tools.setGreeting(user.userId, body.text);
  }

  /** Кому продавать (часть 136): возраст аккаунта, проигранные споры, оценки. */
  @Put('buyer-filter')
  buyerFilter(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(buyerFilterSchema)) body: { minAgeDays: number; maxLostDisputes: number | null; noBadReviews: boolean },
  ) {
    return this.tools.setBuyerFilter(user.userId, body);
  }

  @Put('auto-raise')
  autoRaise(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(autoRaiseSchema)) body: { on: boolean },
  ) {
    return this.tools.setAutoRaise(user.userId, body.on);
  }

  /** Заготовки для чата — их список открывается из поля сообщения. */
  @Get('templates')
  templates(@CurrentUser() user: AuthUser) {
    return this.tools.templates(user.userId);
  }

  @Post('templates')
  add(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(templateSchema)) body: TemplateInput,
  ) {
    return this.tools.addTemplate(user.userId, body);
  }

  @Put('templates/:id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(templateSchema)) body: TemplateInput,
  ) {
    return this.tools.updateTemplate(user.userId, id, body);
  }

  @Delete('templates/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tools.removeTemplate(user.userId, id);
  }
}
