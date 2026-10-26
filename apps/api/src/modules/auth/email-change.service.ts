import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { deviceOf } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../access/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TokenService } from './token.service';
import { TwoFactorService } from './twofactor.service';
import type { RequestCtx } from './auth.service';
import { maskEmail } from '../../common/mask';
import { langOf, say } from '../../i18n/texts';

/** Ссылка подтвердить новую почту — сутки. */
export const EMAIL_CHANGE_TTL = 86_400;
/** «Это не я» со старой почты — 7 дней. */
export const EMAIL_REVERT_TTL = 7 * 86_400;
const REVERT_MS = EMAIL_REVERT_TTL * 1000;

const INVALID = 'Ссылка недействительна или истекла';

type Change = Prisma.EmailChangeGetPayload<object>;

/**
 * Почта ушла из аккаунта меньше 7 дней назад — её ещё могут вернуть по «Это
 * не я». Другой аккаунт занять её не может: иначе вернуть её было бы некуда.
 */
export async function emailReserved(prisma: PrismaClient, email: string, exceptUserId?: string) {
  const n = await prisma.emailChange.count({
    where: {
      oldEmail: { equals: email, mode: 'insensitive' },
      status: 'done',
      confirmedAt: { gt: new Date(Date.now() - REVERT_MS) },
      ...(exceptUserId ? { userId: { not: exceptUserId } } : {}),
    },
  });
  return n > 0;
}

/**
 * Смена почты из «Безопасности». Почта — ключ от аккаунта: по ней сбрасывают
 * пароль. Поэтому:
 * - просить — с паролем (если он есть) и кодом из приложения (если включён);
 * - сменится, только когда откроют ссылку, пришедшую на новую почту;
 * - старой почте — письмо со ссылкой «Это не я» на 7 дней: вернуть прежнюю
 *   почту и задать новый пароль; все устройства выходят, вход с кодом и
 *   входы через сервисы отключаются — их мог завести тот, кто сменил почту;
 * - пока ссылка жива, старую почту не занять другому аккаунту.
 *
 * Смена почты сотрудником по «Не могу войти» сюда не относится: там старая
 * почта, скорее всего, у чужого — вернуть по ней аккаунт значило бы отдать
 * его тому, от кого восстанавливали.
 */
@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly twofactor: TwoFactorService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly moduleRef: ModuleRef,
  ) {}

  /** Просьба сменить (или добавить) почту: письмо со ссылкой — на новую. */
  async request(
    userId: string,
    input: { email: string; password?: string; code?: string },
    ctx: RequestCtx = {},
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, passwordHash: true, locale: true },
    });
    if (!user) throw new UnauthorizedException('Пользователь не найден');
    const email = input.email.trim().toLowerCase();
    if (user.email?.toLowerCase() === email) {
      throw new BadRequestException('Это и есть почта аккаунта');
    }
    if (
      user.passwordHash &&
      !(input.password && (await bcrypt.compare(input.password, user.passwordHash)))
    ) {
      throw new BadRequestException('Текущий пароль неверный');
    }
    const tf = await this.twofactor.check(userId, input.code);
    if (tf !== 'ok') throw TwoFactorService.loginError(tf);
    if (await this.busy(email, userId)) {
      throw new ConflictException('Эта почта уже у другого аккаунта');
    }
    // Новая просьба заменяет прежнюю: ссылка из прошлого письма гаснет.
    await this.prisma.emailChange.updateMany({
      where: { userId, status: 'pending' },
      data: { status: 'canceled' },
    });
    const change = await this.prisma.emailChange.create({
      data: {
        userId,
        oldEmail: user.email,
        newEmail: email,
        device: deviceOf(ctx.userAgent),
        ip: ctx.ip ?? null,
      },
    });
    const token = this.tokens.signData({ cid: change.id }, 'email_change', EMAIL_CHANGE_TTL);
    const lang = langOf(user.locale);
    await this.mail.send(
      email,
      say(lang, 'Подтвердите новую почту — GameMarket'),
      say(
        lang,
        'Чтобы сделать эту почту почтой аккаунта GameMarket, откройте ссылку (действует сутки): {link}\nЕсли вы ничего не меняли — проигнорируйте письмо.',
        { link: `${this.web()}/email/confirm?token=${encodeURIComponent(token)}` },
      ),
    );
    return { ok: true, mailed: this.mail.enabled };
  }

  /** Ссылка из письма на новую почту: почта сменена и подтверждена. */
  async confirm(token: string) {
    const change = await this.byToken(token, 'email_change');
    if (change.status !== 'pending') throw new BadRequestException(INVALID);
    const user = await this.prisma.user.findUnique({
      where: { id: change.userId },
      select: { email: true },
    });
    // Почту успели сменить иначе — эта просьба устарела.
    if ((user?.email ?? '').toLowerCase() !== (change.oldEmail ?? '').toLowerCase()) {
      throw new BadRequestException(INVALID);
    }
    if (await this.busy(change.newEmail, change.userId)) {
      throw new ConflictException('Эта почта уже у другого аккаунта');
    }
    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const done = await tx.emailChange.updateMany({
          where: { id: change.id, status: 'pending' },
          data: { status: 'done', confirmedAt: now },
        });
        if (!done.count) throw new BadRequestException(INVALID);
        await tx.user.update({
          where: { id: change.userId },
          data: { email: change.newEmail, emailVerified: now },
        });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Эта почта уже у другого аккаунта');
      }
      throw e;
    }
    await this.audit.log({
      actorId: change.userId,
      action: 'email.change',
      entityType: 'user',
      entityId: change.userId,
      before: { email: change.oldEmail },
      after: { email: change.newEmail },
      ip: change.ip ?? undefined,
    });
    await this.announce({ ...change, confirmedAt: now });
    return { ok: true, email: change.newEmail };
  }

  /** Страница «Это не я»: на какую почту сменили (без полного адреса) и до какого времени можно вернуть. */
  async revertStatus(token: string) {
    const change = await this.revertable(token);
    return {
      ok: true,
      email: maskEmail(change.newEmail),
      until: new Date(change.confirmedAt!.getTime() + REVERT_MS),
    };
  }

  /**
   * «Это не я»: вернуть прежнюю почту и задать новый пароль. Сменивший почту
   * знал пароль и мог завести вход с кодом, Telegram и сервисы входа — всё
   * это снимается, все устройства выходят.
   */
  async revert(token: string, password: string) {
    const change = await this.revertable(token);
    const oldEmail = change.oldEmail!;
    if (await this.busy(oldEmail, change.userId)) {
      throw new ConflictException('Прежняя почта уже у другого аккаунта — напишите в поддержку');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const back = await tx.emailChange.updateMany({
        where: { id: change.id, status: 'done' },
        data: { status: 'reverted', revertedAt: now },
      });
      if (!back.count) throw new BadRequestException(INVALID);
      await tx.twoFactor.deleteMany({ where: { userId: change.userId } });
      await tx.socialAccount.deleteMany({ where: { userId: change.userId } });
      await tx.pushSubscription.deleteMany({ where: { userId: change.userId } });
      await tx.authSession.deleteMany({ where: { userId: change.userId } });
      await tx.user.update({
        where: { id: change.userId },
        data: { email: oldEmail, emailVerified: now, passwordHash, telegramId: null },
      });
    });
    await this.audit.log({
      actorId: change.userId,
      action: 'email.revert',
      entityType: 'user',
      entityId: change.userId,
      before: { email: change.newEmail },
      after: { email: oldEmail },
    });
    this.notify(change.userId, (lang) =>
      say(
        lang,
        'Прежняя почта аккаунта возвращена по ссылке «Это не я»: пароль новый, все устройства вышли, вход с кодом и входы через сервисы отключены.',
      ),
    );
    return { ok: true, email: oldEmail };
  }

  /** Занята ли почта другим аккаунтом — или ждёт возврата по «Это не я». */
  private async busy(email: string, userId: string) {
    const taken = await this.prisma.user.count({
      where: { email: { equals: email, mode: 'insensitive' }, id: { not: userId } },
    });
    return taken > 0 || (await emailReserved(this.prisma, email, userId));
  }

  private async byToken(token: string, purpose: 'email_change' | 'email_revert'): Promise<Change> {
    let data: { cid: string };
    try {
      data = this.tokens.verifyData<{ cid: string }>(token, purpose);
    } catch {
      throw new BadRequestException(INVALID);
    }
    const change = await this.prisma.emailChange.findUnique({ where: { id: data.cid } });
    if (!change) throw new BadRequestException(INVALID);
    return change;
  }

  /** Смену можно вернуть: подтверждена меньше 7 дней назад и почта с тех пор не менялась. */
  private async revertable(token: string) {
    const change = await this.byToken(token, 'email_revert');
    if (
      change.status !== 'done' ||
      !change.oldEmail ||
      !change.confirmedAt ||
      change.confirmedAt.getTime() < Date.now() - REVERT_MS
    ) {
      throw new BadRequestException(INVALID);
    }
    const user = await this.prisma.user.findUnique({
      where: { id: change.userId },
      select: { email: true },
    });
    if (user?.email?.toLowerCase() !== change.newEmail.toLowerCase()) {
      throw new BadRequestException(INVALID);
    }
    return change;
  }

  /**
   * Почта сменена: владельцу — уведомление (письмом — уже на новую), старой
   * почте — письмо со ссылкой «Это не я». Она есть только в этом письме.
   */
  private async announce(change: Change) {
    const user = await this.prisma.user.findUnique({
      where: { id: change.userId },
      select: { locale: true },
    });
    const lang = langOf(user?.locale);
    const device = change.device ?? '—';
    const ip = change.ip ?? '—';
    this.notify(change.userId, () =>
      say(lang, 'Почта аккаунта изменена на {email}: {device}, IP {ip}.', {
        email: maskEmail(change.newEmail),
        device,
        ip,
      }),
    );
    if (!change.oldEmail) return;
    const token = this.tokens.signData({ cid: change.id }, 'email_revert', EMAIL_REVERT_TTL);
    await this.mail.send(
      change.oldEmail,
      say(lang, 'Почта аккаунта изменена — GameMarket'),
      say(
        lang,
        'Почту аккаунта GameMarket сменили на {email}: {device}, IP {ip}. Если это сделали не вы — верните прежнюю почту по ссылке (действует 7 дней): {link}\nВсе устройства выйдут из аккаунта, вход с кодом и входы через сервисы отключатся, пароль нужно будет задать новый.',
        {
          email: maskEmail(change.newEmail),
          device,
          ip,
          link: `${this.web()}/email/revert?token=${encodeURIComponent(token)}`,
        },
      ),
    );
  }

  /** Уведомление «Почта аккаунта изменена» — группа «Безопасность», письмом всегда. */
  private notify(userId: string, preview: (lang: 'ru' | 'en') => string) {
    const send = async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { locale: true },
      });
      await this.moduleRef
        .get(NotificationsService, { strict: false })
        .notify(userId, 'email_changed', { preview: preview(langOf(user?.locale)) });
    };
    void send().catch((e: Error) => this.logger.warn(`Почта ${userId}: ${e.message}`));
  }

  private web() {
    return process.env.WEB_URL ?? 'http://localhost:3000';
  }
}
