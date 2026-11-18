import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Put, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator';
import { BlocksService } from '../access/blocks.service';
import { AccountService } from './account.service';
import { ConsentService } from './consent.service';
import { DeletionService } from './deletion.service';
import { ExportService } from './export.service';
import { ctxOf } from '../auth/auth-http';
import { PushService, type PushSubscriptionInput } from '../notifications/push.service';
import { NOTIFY_GROUPS, isSteamTradeUrl } from '@gamemarket/shared';
import { RateLimit } from '../../common/rate-limit';

// Группы — ровно те, что в shared/notify.ts: лишний ключ не попадёт в базу.
const groupFlags = z
  .object(Object.fromEntries(NOTIFY_GROUPS.map((g) => [g.key, z.boolean().optional()])) as Record<string, z.ZodOptional<z.ZodBoolean>>)
  .strict();
const notifySchema = z.object({ email: groupFlags.optional(), telegram: groupFlags.optional(), push: groupFlags.optional() });

// Подписка браузера, как её отдаёт PushSubscription.toJSON(): адрес службы
// пушей и ключи шифрования — точка P-256 (65 байт) и секрет (16 байт).
const endpointSchema = z.string().url().max(1000);
const pushSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{86,88}={0,2}$/, 'Неверный ключ подписки'),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22,24}={0,2}$/, 'Неверный ключ подписки'),
  }),
});

const localeSchema = z.object({ locale: z.enum(['ru', 'en']) });

const profileSchema = z.object({
  displayName: z.string().trim().min(2, 'Имя — от 2 символов').max(40, 'Имя — до 40 символов').optional(),
  bio: z.string().trim().max(500, 'О себе — до 500 символов').nullable().optional(),
});

const deletionSchema = z.object({
  username: z.string().trim().min(1, 'Впишите свой ник').max(40),
  password: z.string().max(200).optional(),
  code: z.string().trim().max(20).optional(),
  // Остаток меньше вывода сгорит — человек это подтвердил.
  forfeit: z.boolean().optional(),
});

const steamTradeSchema = z.object({
  url: z
    .string()
    .trim()
    .max(100)
    .refine((v) => v === '' || isSteamTradeUrl(v), 'Ссылка на обмен Steam — вида https://steamcommunity.com/tradeoffer/new/?partner=…&token=…')
    .transform((v) => v || null)
    .nullable(),
});

@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly blocks: BlocksService,
    private readonly push: PushService,
    private readonly consent: ConsentService,
    private readonly deletion: DeletionService,
    private readonly exporter: ExportService,
  ) {}

  /** «Скачать мои данные» (к части 124): всё о человеке одним файлом JSON. */
  @Get('export')
  @RateLimit('account-export', 5, 3600)
  async exportData(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    const data = await this.exporter.export(user.userId);
    res.setHeader('Content-Disposition', `attachment; filename="gamemarket-data-${data.generatedAt.slice(0, 10)}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    return data;
  }

  /** Удаление аккаунта (часть 124): что мешает и что спросит форма. */
  @Get('deletion')
  deletionStatus(@CurrentUser() user: AuthUser) {
    return this.deletion.status(user.userId);
  }

  /** Удалить аккаунт: ник, пароль и код, если есть; при сделках, спорах и деньгах — 409. */
  @Post('deletion')
  @HttpCode(200)
  @RateLimit('account-deletion', 10, 3600)
  deleteAccount(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(deletionSchema)) body: z.infer<typeof deletionSchema>,
  ) {
    return this.deletion.request(user.userId, body);
  }

  /** Согласие на обработку ПД (часть 120): действующее, история, текущая редакция. */
  @Get('consent')
  consentStatus(@CurrentUser() user: AuthUser) {
    return this.consent.status(user.userId);
  }

  @Post('consent')
  @HttpCode(200)
  giveConsent(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.consent.give(user.userId, ctxOf(req));
  }

  @Post('consent/revoke')
  @HttpCode(200)
  revokeConsent(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.consent.revoke(user.userId, ctxOf(req));
  }

  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.account.profile(user.userId);
  }

  /** Счётчики шапки: сообщения, уведомления, баланс, продажи и покупки, ждущие действия. */
  @Get('summary')
  summary(@CurrentUser() user: AuthUser) {
    return this.account.summary(user.userId);
  }

  @Patch('profile')
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(profileSchema)) body: { displayName?: string; bio?: string | null },
  ) {
    return this.account.updateProfile(user.userId, body);
  }

  @Post('avatar')
  @RateLimit('uploads', 30, 600)
  @UseInterceptors(FileInterceptor('file'))
  avatar(@CurrentUser() user: AuthUser, @UploadedFile() file: { buffer: Buffer; mimetype: string; size: number }) {
    return this.account.setAvatar(user.userId, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.account.removeAvatar(user.userId);
  }

  /** Ссылка на обмен Steam (часть 142): подстановка в заказ и правка в «Настройках». */
  @Get('steam-trade')
  steamTrade(@CurrentUser() user: AuthUser) {
    return this.account.steamTrade(user.userId);
  }

  @Put('steam-trade')
  setSteamTrade(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(steamTradeSchema)) body: { url: string | null }) {
    return this.account.setSteamTrade(user.userId, body.url);
  }

  /** Язык писем, Telegram и пушей — сайт присылает его при смене языка. */
  @Put('locale')
  setLocale(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(localeSchema)) body: { locale: 'ru' | 'en' }) {
    return this.account.setLocale(user.userId, body.locale);
  }

  // ── Уведомления ──
  @Get('notifications')
  notifications(@CurrentUser() user: AuthUser) {
    return this.account.notifications(user.userId);
  }

  @Patch('notifications')
  updateNotifications(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(notifySchema))
    body: { email?: Record<string, boolean>; telegram?: Record<string, boolean>; push?: Record<string, boolean> },
  ) {
    return this.account.updateNotifications(user.userId, body);
  }

  @Post('telegram/link')
  telegramLink(@CurrentUser() user: AuthUser) {
    return this.account.telegramLink(user.userId);
  }

  @Delete('telegram')
  telegramUnlink(@CurrentUser() user: AuthUser) {
    return this.account.telegramUnlink(user.userId);
  }

  /** Пуши на это устройство: браузер присылает свою подписку. */
  @Post('push')
  pushSubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(pushSchema)) body: PushSubscriptionInput,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.push.subscribe(user.userId, body, userAgent);
  }

  /** Выключить пуши на устройстве — в настройках и при выходе из аккаунта. */
  @Delete('push')
  pushUnsubscribe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(z.object({ endpoint: endpointSchema }))) body: { endpoint: string },
  ) {
    return this.push.unsubscribe(user.userId, body.endpoint);
  }

  // ── Чёрный список ──
  @Get('blocks')
  blocksList(@CurrentUser() user: AuthUser) {
    return this.blocks.list(user.userId);
  }

  @Post('blocks')
  block(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(z.object({ userId: z.string().uuid() }))) body: { userId: string }) {
    return this.blocks.add(user.userId, body.userId);
  }

  @Delete('blocks/:userId')
  unblock(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.blocks.remove(user.userId, userId);
  }
}
