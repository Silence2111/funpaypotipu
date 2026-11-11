import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { PD_CONSENT_REQUIRED, PD_CONSENT_VERSION, suggestUsername, usernameSchema } from '@gamemarket/shared';
import { PRISMA } from '../../../prisma/prisma.module';
import { AuthService, type IssuedAuth, type RequestCtx } from '../auth.service';
import { TokenService } from '../token.service';
import { emailReserved } from '../email-change.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { Interval } from '@nestjs/schedule';
import {
  OAuthError,
  PROVIDER_LABEL,
  authorizeUrl,
  fetchProfile,
  isOAuthProvider,
  oauthConfig,
  OAUTH_PROVIDERS,
  pkce,
  type OAuthProvider,
  type SocialProfile,
  type SocialProvider,
} from './providers';

/** Состояние входа (state, PKCE, куда вернуть) — между началом и возвратом. */
export const STATE_COOKIE = 'gm_oauth';
export const STATE_PATH = '/api/auth/oauth';
/** Билет: сервис подтвердил личность, осталось выбрать ник или ввести код. */
export const TICKET_COOKIE = 'gm_social';
/** Намерение привязать сервис к аккаунту, в котором уже вошли. */
export const LINK_COOKIE = 'gm_link';
export const SOCIAL_PATH = '/api/auth';
/** Как часто искать аккаунты, которым нечем войти после отключения Telegram. */
const TELEGRAM_OFF_SWEEP_MS = Number(process.env.TELEGRAM_OFF_SWEEP_MS ?? 24 * 3600_000);
/** Десять минут на вход в сервисе. */
export const SOCIAL_TTL = 600;

interface OAuthState {
  provider: OAuthProvider;
  state: string;
  verifier: string;
  next: string;
  link: string | null;
}

const apiUrl = () =>
  (process.env.API_PUBLIC_URL ?? process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const webUrl = () => (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/** Куда вернуть после входа: только путь на этом сайте, не чужой адрес. */
export const safeNext = (next: unknown): string =>
  typeof next === 'string' && next.length < 300 && /^\/(?![/\\])[^\s\\]*$/.test(next) ? next : '/';

const ticketError = (
  status: number,
  error: string,
  message: string,
  extra: Record<string, unknown> = {},
) => new HttpException({ statusCode: status, message, error, ...extra }, status);

/**
 * Вход через Telegram убран (часть 118): Telegram нет в перечне способов
 * авторизации ч. 10 ст. 8 149-ФЗ, штраф — ст. 13.55 КоАП с 07.07.2026.
 * Старым версиям сайта и старым билетам — понятный ответ, а не 404.
 */
export const telegramLoginRemoved = () =>
  ticketError(
    410,
    'telegram_login_removed',
    'Вход через Telegram отключён по закону (149-ФЗ, ч. 10 ст. 8). Войдите по почте и паролю, через Яндекс ID или VK ID',
  );

/** Способы входа, которые ещё работают: почта с паролем или Яндекс ID / VK ID. */
export const canSignIn = (u: { passwordHash: string | null; email: string | null; socialAccounts: Array<{ provider: string }> }) =>
  !!(u.passwordHash && u.email) || u.socialAccounts.some((a) => (OAUTH_PROVIDERS as readonly string[]).includes(a.provider));

/**
 * Вход через VK ID и Яндекс ID. Сервис подтверждает личность, площадка
 * находит аккаунт: привязанный, по почте,
 * которую подтвердили и сервис, и площадка, — или заводит новый, спросив
 * ник. Дальше — тот же вход, что по паролю: блокировка, код из приложения,
 * сеанс в списке устройств.
 */
@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Какие кнопки показать: без ключей сервиса кнопки нет. Telegram — всегда
   * null: вход через него убран (149-ФЗ, ч. 10 ст. 8; часть 118), поле
   * оставлено, чтобы старые версии сайта не ломались.
   */
  providers() {
    return {
      yandex: !!oauthConfig('yandex'),
      vk: !!oauthConfig('vk'),
      telegram: null,
    };
  }

  redirectUri(provider: OAuthProvider) {
    return `${apiUrl()}/api/auth/oauth/${provider}/callback`;
  }

  linkCookie(userId: string): string {
    return this.tokens.signData({ userId }, 'social_link', SOCIAL_TTL);
  }

  private linkUser(cookie: string | undefined): string | null {
    if (!cookie) return null;
    try {
      return this.tokens.verifyData<{ userId: string }>(cookie, 'social_link').userId;
    } catch {
      return null;
    }
  }

  /** Начало входа: адрес сервиса и подписанное состояние — в cookie этого браузера. */
  start(
    provider: string,
    next: unknown,
    linkCookie?: string,
  ): { url: string; stateCookie: string } {
    if (!isOAuthProvider(provider)) throw new NotFoundException('Нет такого сервиса');
    const c = oauthConfig(provider);
    if (!c) throw new NotFoundException(`Вход через ${PROVIDER_LABEL[provider]} не подключён`);
    const { verifier, challenge } = pkce();
    const state = randomBytes(16).toString('base64url');
    const data: OAuthState = {
      provider,
      state,
      verifier,
      next: safeNext(next),
      link: this.linkUser(linkCookie),
    };
    return {
      url: authorizeUrl(c, { redirectUri: this.redirectUri(provider), state, challenge }),
      stateCookie: this.tokens.signData({ ...data }, 'oauth_state', SOCIAL_TTL),
    };
  }

  /**
   * Возврат от сервиса. state должен совпасть с cookie этого браузера, код
   * обменивается с PKCE: чужой код, подсунутый ссылкой, не войдёт и не
   * привяжется. Вход — билет и страница завершения; привязка — сразу.
   */
  async callback(
    provider: string,
    q: { code?: string; state?: string; device_id?: string; error?: string },
    stateCookie: string | undefined,
  ): Promise<{ redirect: string; ticket?: string }> {
    const fail = (reason: string) => ({ redirect: `${webUrl()}/login?social_error=${reason}` });
    if (!isOAuthProvider(provider)) return fail('unknown');
    let st: OAuthState;
    try {
      st = this.tokens.verifyData<OAuthState>(stateCookie ?? '', 'oauth_state');
    } catch {
      return fail('expired');
    }
    if (st.provider !== provider || !q.state || q.state !== st.state) return fail('state');
    if (q.error || !q.code) return fail('cancelled');
    const c = oauthConfig(provider);
    if (!c) return fail('disabled');
    let profile: SocialProfile;
    try {
      profile = await fetchProfile(c, {
        code: q.code,
        verifier: st.verifier,
        redirectUri: this.redirectUri(provider),
        state: q.state,
        deviceId: q.device_id,
      });
    } catch (e) {
      this.logger.warn(`Вход через ${provider}: ${(e as Error).message}`);
      return fail(e instanceof OAuthError ? 'provider' : 'network');
    }
    if (st.link) {
      const result = await this.link(st.link, profile).then(
        () => 'linked',
        (e: unknown) => (e instanceof HttpException ? 'conflict' : 'error'),
      );
      return { redirect: `${webUrl()}/cabinet/security?social=${result}&provider=${provider}` };
    }
    return {
      redirect: `${webUrl()}/login/social?next=${encodeURIComponent(st.next)}`,
      ticket: this.ticket(profile),
    };
  }

  private ticket(profile: SocialProfile): string {
    return this.tokens.signData({ ...profile }, 'social_ticket', SOCIAL_TTL);
  }


  /** Завершение входа по билету: ник для нового аккаунта, код — если включена защита. */
  async complete(
    ticketCookie: string | undefined,
    input: { code?: string; username?: string; pdConsent?: boolean },
    ctx: RequestCtx,
  ): Promise<IssuedAuth> {
    let profile: SocialProfile;
    try {
      profile = this.tokens.verifyData<SocialProfile>(ticketCookie ?? '', 'social_ticket');
    } catch {
      throw ticketError(401, 'social_expired', 'Вход через сервис устарел — начните заново');
    }
    // Билет Telegram, выданный до части 118, — тоже не вход.
    if (profile.provider === 'telegram') throw telegramLoginRemoved();
    const userId = await this.resolve(profile, input.username?.trim().toLowerCase(), {
      consent: input.pdConsent === true,
      ctx,
    });
    return this.auth.loginVerified(userId, input.code?.trim(), ctx);
  }

  private async resolve(
    p: SocialProfile,
    username: string | undefined,
    consent: { consent: boolean; ctx: RequestCtx },
  ): Promise<string> {
    const linked = await this.prisma.socialAccount.findUnique({
      where: { provider_subject: { provider: p.provider, subject: p.subject } },
    });
    if (linked) {
      await this.prisma.socialAccount.update({
        where: { id: linked.id },
        data: { lastUsedAt: new Date() },
      });
      return linked.userId;
    }
    if (p.email) {
      const local = await this.prisma.user.findUnique({
        where: { email: p.email },
        select: { id: true, emailVerified: true },
      });
      if (local) {
        // Почту подтвердили и сервис, и площадка — это тот же человек. Иначе
        // аккаунт с этой почтой мог завести кто-то другой, и вход через
        // сервис отдал бы его владельцу почты вместе с чужим паролем.
        if (p.emailVerified && local.emailVerified) {
          await this.attach(local.id, p);
          return local.id;
        }
        throw ticketError(
          409,
          'social_email_taken',
          `Аккаунт с почтой ${p.email} уже есть. Войдите по почте и паролю и подключите ${PROVIDER_LABEL[p.provider]} в «Безопасности».`,
        );
      }
    }
    return this.create(p, username, consent);
  }

  /** Новый аккаунт: ник выбирает человек, подсказка — из имени в сервисе. */
  private async create(
    p: SocialProfile,
    username: string | undefined,
    consent: { consent: boolean; ctx: RequestCtx },
  ): Promise<string> {
    const suggested = await this.freeUsername(
      suggestUsername(p.nick, p.name, p.email?.split('@')[0]),
    );
    if (!username) {
      throw ticketError(
        400,
        'username_required',
        'Выберите ник — по нему вас найдут покупатели и продавцы',
        {
          suggested,
          name: p.name,
          provider: p.provider,
        },
      );
    }
    const parsed = usernameSchema.safeParse(username);
    if (!parsed.success)
      throw new BadRequestException(`Ник: ${parsed.error.issues[0]?.message ?? 'не подходит'}`);
    if (await this.prisma.profile.findUnique({ where: { username }, select: { userId: true } })) {
      throw ticketError(409, 'username_taken', 'Этот ник занят', { suggested });
    }
    // Отдельное согласие на обработку ПД (часть 120): без него аккаунт не
    // заводится и через Яндекс ID или VK ID.
    if (!consent.consent) {
      throw ticketError(400, 'consent_required', PD_CONSENT_REQUIRED, { provider: p.provider });
    }
    const name = p.name && p.name.trim().length >= 2 ? p.name.trim().slice(0, 40) : username;
    // Почта сервиса, ушедшая из другого аккаунта меньше 7 дней назад, ждёт
    // возврата по «Это не я» — новый аккаунт заводится без неё.
    const email = p.email && !(await emailReserved(this.prisma, p.email)) ? p.email : null;
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          emailVerified: email && p.emailVerified ? new Date() : null,
          profile: { create: { username, displayName: name } },
          consents: {
            create: {
              version: PD_CONSENT_VERSION,
              method: p.provider,
              ip: consent.ctx.ip?.slice(0, 64) ?? null,
              userAgent: consent.ctx.userAgent?.slice(0, 300) ?? null,
            },
          },
          socialAccounts: {
            create: {
              provider: p.provider,
              subject: p.subject,
              email: p.email,
              name: p.name,
              lastUsedAt: new Date(),
            },
          },
        },
        select: { id: true },
      });
      return user.id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException(
          'Ник или аккаунт уже заняты — обновите страницу и попробуйте ещё раз',
        );
      }
      throw e;
    }
  }

  private async freeUsername(base: string): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const candidate = i === 0 ? base : `${base.slice(0, 28)}${i + 1}`;
      if (
        !(await this.prisma.profile.findUnique({
          where: { username: candidate },
          select: { userId: true },
        }))
      ) {
        return candidate;
      }
    }
    return `${base.slice(0, 20)}_${randomBytes(3).toString('hex')}`;
  }

  /** Привязать аккаунт сервиса к пользователю. */
  private async attach(userId: string, p: SocialProfile) {
    const mine = await this.prisma.socialAccount.findUnique({
      where: { userId_provider: { userId, provider: p.provider } },
    });
    if (mine && mine.subject !== p.subject) {
      throw new ConflictException(
        `К аккаунту уже подключён другой ${PROVIDER_LABEL[p.provider]} — сначала отключите его в «Безопасности»`,
      );
    }
    if (!mine) {
      await this.prisma.socialAccount.create({
        data: {
          userId,
          provider: p.provider,
          subject: p.subject,
          email: p.email,
          name: p.name,
          lastUsedAt: new Date(),
        },
      });
    }
  }

  /** Подключить сервис в «Безопасности», уже войдя в аккаунт. */
  async link(userId: string, p: SocialProfile) {
    const taken = await this.prisma.socialAccount.findUnique({
      where: { provider_subject: { provider: p.provider, subject: p.subject } },
    });
    if (taken && taken.userId !== userId) {
      throw new ConflictException(
        `Этот ${PROVIDER_LABEL[p.provider]} уже привязан к другому аккаунту`,
      );
    }
    if (!taken) await this.attach(userId, p);
    return this.accounts(userId);
  }

  /**
   * Отключить сервис. Последний способ входа не отключается: вход по паролю
   * — это почта и пароль, без почты (аккаунт из Telegram) пароль не поможет.
   */
  async unlink(userId: string, provider: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        email: true,
        socialAccounts: { select: { id: true, provider: true } },
      },
    });
    const account = user?.socialAccounts.find((a) => a.provider === provider);
    if (!user || !account) throw new NotFoundException('Сервис не подключён');
    // Последний работающий способ входа не отключается. Старая привязка
    // Telegram входом не считается (часть 118) — её убрать можно всегда.
    const rest = { ...user, socialAccounts: user.socialAccounts.filter((a) => a.id !== account.id) };
    if (provider !== 'telegram' && canSignIn(user) && !canSignIn(rest)) {
      throw new BadRequestException(
        user.email
          ? 'Это единственный способ входа — сначала задайте пароль'
          : 'Это единственный способ входа — сначала подключите другой сервис',
      );
    }
    await this.prisma.socialAccount.delete({ where: { id: account.id } });
    return this.accounts(userId);
  }

  /** Способы входа в «Безопасности»: пароль и подключённые сервисы. */
  async accounts(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        passwordHash: true,
        email: true,
        socialAccounts: { select: { provider: true, name: true, email: true, createdAt: true } },
      },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return {
      hasPassword: !!user.passwordHash,
      email: user.email,
      providers: this.providers(),
      // Нечем войти, кроме старого Telegram: сайт просит добавить почту и пароль.
      needsLoginMethod: !canSignIn(user),
      accounts: user.socialAccounts.map((a) => ({
        provider: a.provider as SocialProvider,
        name: a.name,
        email: a.email,
        since: a.createdAt,
        // Привязка Telegram осталась, но вход через неё отключён.
        disabled: a.provider === 'telegram',
      })),
    };
  }

  /**
   * Тем, кто входил только через Telegram, — одно уведомление: вход отключён,
   * добавьте почту и пароль (уходит на сайт и в бот Telegram, если он
   * подключён к уведомлениям). Раз в сутки — для новых таких аккаунтов.
   */
  @Interval('telegram-login-off', TELEGRAM_OFF_SWEEP_MS)
  async notifyTelegramOnly(): Promise<number> {
    const users = await this.prisma.user.findMany({
      where: {
        status: { not: 'banned' },
        socialAccounts: { some: { provider: 'telegram' }, none: { provider: { in: [...OAUTH_PROVIDERS] } } },
        OR: [{ passwordHash: null }, { email: null }],
        notifications: { none: { type: 'login_method_needed' } },
      },
      take: 500,
      select: { id: true },
    });
    for (const u of users) {
      await this.notifications
        .notify(u.id, 'login_method_needed', {})
        .catch((e) => this.logger.warn(`Уведомление ${u.id}: ${(e as Error).message}`));
    }
    return users.length;
  }
}
