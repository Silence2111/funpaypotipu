import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@gamemarket/db';
import { LOCKED_NOTIFY, maskContacts, notifyPrefs, type NotifyPrefs } from '@gamemarket/shared';
import { Prisma } from '@gamemarket/db';
import { TelegramService } from '../notifications/telegram.service';
import { PRISMA } from '../../prisma/prisma.module';
import { StorageService } from '../storage/storage.service';
import { assetUrl } from '../storage/asset-url';

/** Аватар — только растровые картинки: svg из хранилища отдавался бы как документ. */
const AVATAR_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const AVATAR_MAX = 2 * 1024 * 1024;

/** Профиль: имя, о себе, аватар. Ник не меняется — по нему находят продавца и отзывы. */
@Injectable()
export class AccountService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly storage: StorageService,
    private readonly telegram: TelegramService,
  ) {}

  // ── Уведомления ──

  async notifications(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notifyPrefs: true, telegramId: true, email: true },
    });
    if (!user) throw new NotFoundException('Пользователь не найден');
    return {
      prefs: notifyPrefs(user.notifyPrefs as NotifyPrefs | null),
      locked: LOCKED_NOTIFY,
      email: { address: user.email },
      telegram: { available: this.telegram.enabled, linked: !!user.telegramId, bot: this.telegram.botUsername || null },
    };
  }

  async updateNotifications(userId: string, patch: NotifyPrefs) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { notifyPrefs: true } });
    const saved = (user?.notifyPrefs as NotifyPrefs | null) ?? {};
    const next: NotifyPrefs = {
      email: { ...(saved.email ?? {}), ...(patch.email ?? {}) },
      telegram: { ...(saved.telegram ?? {}), ...(patch.telegram ?? {}) },
    };
    await this.prisma.user.update({ where: { id: userId }, data: { notifyPrefs: next as Prisma.InputJsonValue } });
    return this.notifications(userId);
  }

  /** Ссылка на бота с кодом привязки: открыть в Telegram и нажать «Старт». */
  telegramLink(userId: string) {
    if (!this.telegram.enabled) throw new NotFoundException('Telegram-бот на стенде не подключён');
    return { url: this.telegram.linkUrl(userId) };
  }

  async telegramUnlink(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { telegramId: null } });
    return this.notifications(userId);
  }

  async profile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, emailVerified: true, createdAt: true, profile: true },
    });
    if (!user?.profile) throw new NotFoundException('Профиль не найден');
    const p = user.profile;
    return {
      username: p.username,
      displayName: p.displayName,
      bio: p.bio,
      country: p.country,
      avatarUrl: assetUrl(p.avatarUrl),
      email: user.email,
      emailVerified: !!user.emailVerified,
      memberSince: user.createdAt,
    };
  }

  /**
   * «О себе» видно на витрине продавца: контакты в нём скрываются так же,
   * как в чате и отзывах, — иначе витрина стала бы обходом сделки.
   */
  async updateProfile(userId: string, input: { displayName?: string; bio?: string | null }) {
    const data: { displayName?: string; bio?: string | null } = {};
    if (input.displayName !== undefined) data.displayName = input.displayName;
    if (input.bio !== undefined) data.bio = input.bio ? maskContacts(input.bio).masked : null;
    await this.prisma.profile.update({ where: { userId }, data });
    return this.profile(userId);
  }

  async setAvatar(userId: string, file: { buffer: Buffer; mimetype: string; size: number } | undefined) {
    if (!this.storage.enabled) throw new NotFoundException('Хранилище картинок на стенде не подключено');
    if (!file?.buffer?.length) throw new BadRequestException('Пустой файл');
    const ext = AVATAR_TYPES[file.mimetype];
    if (!ext) throw new BadRequestException('Аватар — PNG, JPG, WebP или GIF');
    if (file.size > AVATAR_MAX) throw new BadRequestException('Аватар больше 2 МБ');
    const key = `avatars/${userId}/${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, file.mimetype);
    await this.prisma.profile.update({ where: { userId }, data: { avatarUrl: key } });
    return { avatarUrl: assetUrl(key) };
  }

  async removeAvatar(userId: string) {
    await this.prisma.profile.update({ where: { userId }, data: { avatarUrl: null } });
    return { avatarUrl: null };
  }
}
