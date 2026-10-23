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
import { COMMAND_MAX } from '@gamemarket/shared';
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
