import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaClient, type PushSubscription } from '@gamemarket/db';
import * as webpush from 'web-push';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';

/** Что уходит на устройство. Показывает его сервис-воркер сайта (public/sw.js). */
export interface PushMessage {
  title: string;
  body: string;
  /** Путь на сайте: нажатие на уведомление открывает его. */
  url: string;
  /** Уведомление с тем же тегом заменяет прежнее: чат или заказ — одно на экране. */
  tag?: string;
}

/** Подписка в том виде, в каком её отдаёт браузер (PushSubscription.toJSON). */
export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const VAPID_SETTING = 'web_push_vapid';

/**
 * Службы пушей браузеров: Chrome — Google, Firefox — Mozilla, Safari — Apple,
 * Edge — Microsoft. На другой адрес сервер слать не будет: подписка с чужим
 * адресом превращала бы каждое уведомление в запрос API к постороннему хосту.
 */
const PUSH_HOSTS = /(^|\.)(googleapis\.com|mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;

/** Адрес подписки — служба пушей браузера по https; вне прода ещё localhost, для проверок. */
export function pushEndpointOk(
  endpoint: string,
  production = process.env.NODE_ENV === 'production',
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (PUSH_HOSTS.test(url.hostname)) return true;
  return !production && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
}

/**
 * Пуш-уведомления на телефон и компьютер (Web Push): приходят, даже когда
 * сайт закрыт. Подписка — на устройство: включается в настройках
 * уведомлений, выключается там же и при выходе из аккаунта.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private vapid: { subject: string; publicKey: string; privateKey: string } | null = null;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  get enabled(): boolean {
    return this.vapid !== null;
  }

  /** Открытый ключ сервера: браузер подписывается на него. */
  get publicKey(): string | null {
    return this.vapid?.publicKey ?? null;
  }

  async onModuleInit() {
    if (process.env.WEB_PUSH === 'off') return;
    try {
      const keys = await this.loadKeys();
      this.vapid = {
        subject:
          process.env.VAPID_SUBJECT ??
          `mailto:${process.env.SMTP_FROM ?? 'no-reply@gamemarket.local'}`,
        ...keys,
      };
    } catch (e) {
      this.logger.warn(`Пуши выключены: ${(e as Error).message}`);
    }
  }

  /**
   * Ключи VAPID — подпись сервера для служб пушей. Из окружения, а без него —
   * созданные при первом запуске и сохранённые в базе (закрытый —
   * зашифрованным): подписки браузеров привязаны к ключу, и новый ключ после
   * перезапуска молча отключил бы все устройства.
   */
  private async loadKeys(): Promise<{ publicKey: string; privateKey: string }> {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
      return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
    const read = async () => {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: VAPID_SETTING } });
      const v = row?.value as { publicKey?: string; privateKeyEnc?: string } | undefined;
      return v?.publicKey && v.privateKeyEnc
        ? { publicKey: v.publicKey, privateKey: this.encryption.decrypt(v.privateKeyEnc) }
        : null;
    };
    const saved = await read();
    if (saved) return saved;
    const fresh = webpush.generateVAPIDKeys();
    try {
      await this.prisma.systemSetting.create({
        data: {
          key: VAPID_SETTING,
          value: {
            publicKey: fresh.publicKey,
            privateKeyEnc: this.encryption.encrypt(fresh.privateKey),
          },
        },
      });
      this.logger.log('Созданы ключи пушей. В проде задайте VAPID_PUBLIC_KEY и VAPID_PRIVATE_KEY');
      return fresh;
    } catch {
      // Другой экземпляр API успел сохранить свои — берём их.
      const other = await read();
      if (!other) throw new Error('ключи не сохранились');
      return other;
    }
  }

  /** Подписка устройства. Тот же браузер у другого пользователя — подписка переходит к нему. */
  async subscribe(userId: string, sub: PushSubscriptionInput, userAgent?: string) {
    if (!this.vapid) throw new NotFoundException('Пуш-уведомления на стенде выключены');
    if (!pushEndpointOk(sub.endpoint))
      throw new BadRequestException('Подписка не от службы пушей браузера');
    const data = {
      userId,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent?.slice(0, 300) ?? null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { endpoint: sub.endpoint, ...data },
      update: data,
    });
    return { devices: await this.devices(userId) };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { devices: await this.devices(userId) };
  }

  devices(userId: string): Promise<number> {
    return this.prisma.pushSubscription.count({ where: { userId } });
  }

  /**
   * Уведомление на все устройства пользователя. Не бросает: пуш — не повод
   * ронять оплату или чат. Подписки, которые служба отозвала (сайт удалили
   * с телефона, уведомления запретили), удаляются.
   */
  async send(userId: string, message: PushMessage, urgent = false): Promise<void> {
    if (!this.vapid) return;
    try {
      const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
      await Promise.all(subs.map((s) => this.deliver(s, message, urgent)));
    } catch (e) {
      this.logger.warn(`Пуши не отправлены: ${(e as Error).message}`);
    }
  }

  private async deliver(s: PushSubscription, message: PushMessage, urgent: boolean) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(message),
        // Сутки службы держат пуш для выключенного телефона; срочные будят его сразу.
        {
          vapidDetails: this.vapid!,
          TTL: 24 * 3600,
          urgency: urgent ? 'high' : 'normal',
          timeout: 10_000,
        },
      );
      await this.prisma.pushSubscription.update({
        where: { id: s.id },
        data: { lastUsedAt: new Date() },
      });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      } else {
        this.logger.warn(`Пуш не доставлен: ${status ?? (e as Error).message}`);
      }
    }
  }
}
