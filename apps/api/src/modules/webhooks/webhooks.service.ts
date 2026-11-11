import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { Prisma, PrismaClient } from '@gamemarket/db';
import { WEBHOOK_RETRY_MINUTES, type SellerWebhookEvent } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';
import { EncryptionService } from '../crypto/encryption.service';

/** Проход доставок: раз в 15 с; в e2e — секунда. */
const SWEEP_MS = Number(process.env.WEBHOOK_SWEEP_MS ?? 15_000);
/** Минута паузы между попытками; в e2e — секунда (`WEBHOOK_RETRY_UNIT_MS`). */
const RETRY_UNIT_MS = Number(process.env.WEBHOOK_RETRY_UNIT_MS ?? 60_000);
const TIMEOUT_MS = 5_000;

/** Подпись тела: `sha256=<hex>` HMAC-SHA256 секретом вебхука. */
export const webhookSignature = (secret: string, body: string) =>
  `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

/** Частные и служебные адреса: на них вебхук в бою не шлём (SSRF). */
function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isIP(h) === 4) {
    const [a, b] = h.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (isIP(h) === 6) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80');
  return false;
}

/**
 * Вебхук продавца (часть 127): «оплачен новый заказ» уходит POST-ом на
 * его адрес с подписью `X-GM-Signature`, событием `X-GM-Event` и номером
 * доставки `X-GM-Delivery`. Ответ не 2xx или тишина 5 с — повтор через 1
 * мин, 5 мин, 30 мин, 2 ч, 6 ч; потом — «не доставлено». В бою — только
 * https и не на частные адреса.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  private sweeping = false;

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly encryption: EncryptionService,
  ) {}

  private checkUrl(raw: string): string {
    let url: URL;
    try {
      url = new URL(raw.trim());
    } catch {
      throw new BadRequestException('Адрес вебхука — полный URL, например https://example.com/gamemarket');
    }
    const prod = process.env.NODE_ENV === 'production';
    if (url.protocol !== 'https:' && (prod || url.protocol !== 'http:')) {
      throw new BadRequestException('Адрес вебхука — только https');
    }
    if (prod && privateHost(url.hostname)) {
      throw new BadRequestException('Адрес вебхука — публичный: на локальные и внутренние адреса не отправляем');
    }
    if (url.username || url.password) throw new BadRequestException('Адрес вебхука — без логина и пароля в ссылке');
    return url.toString();
  }

  async get(userId: string) {
    const hook = await this.prisma.sellerWebhook.findUnique({ where: { userId } });
    if (!hook) return { url: null, deliveries: [] };
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: { webhookId: hook.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, event: true, status: true, attempts: true, responseCode: true, error: true, createdAt: true, deliveredAt: true },
    });
    return { url: hook.url, deliveries };
  }

  /** Задать адрес: новый секрет показывается один раз. */
  async set(userId: string, rawUrl: string) {
    const url = this.checkUrl(rawUrl);
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.prisma.sellerWebhook.upsert({
      where: { userId },
      create: { userId, url, secretEnc: this.encryption.encrypt(secret) },
      update: { url, secretEnc: this.encryption.encrypt(secret) },
    });
    return { url, secret };
  }

  async remove(userId: string) {
    await this.prisma.sellerWebhook.deleteMany({ where: { userId } });
    return { url: null, deliveries: [] };
  }

  /** Событие в очередь: у продавца нет вебхука — ничего. */
  async enqueue(userId: string, event: SellerWebhookEvent, data: Record<string, unknown>) {
    const hook = await this.prisma.sellerWebhook.findUnique({ where: { userId }, select: { id: true } });
    if (!hook) return null;
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id,
        event,
        payload: { event, createdAt: new Date().toISOString(), data } as Prisma.InputJsonValue,
      },
    });
    // Первая попытка — сразу, не ждать прохода.
    void this.deliver(delivery.id).catch((e: Error) => this.logger.warn(`Вебхук ${delivery.id}: ${e.message}`));
    return delivery.id;
  }

  async test(userId: string) {
    const id = await this.enqueue(userId, 'ping', { message: 'Проверка вебхука GameMarket', id: randomUUID() });
    if (!id) throw new NotFoundException('Сначала задайте адрес вебхука');
    return { deliveryId: id };
  }

  /** Одна попытка доставки; итог — в строке доставки. */
  async deliver(id: string) {
    const d = await this.prisma.webhookDelivery.findUnique({ where: { id }, include: { webhook: true } });
    if (!d || d.status !== 'pending') return;
    const body = JSON.stringify(d.payload);
    const secret = this.encryption.decrypt(d.webhook.secretEnc);
    let code: number | null = null;
    let error: string | null = null;
    try {
      const res = await fetch(d.webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'GameMarket-Webhook/1',
          'X-GM-Event': d.event,
          'X-GM-Delivery': d.id,
          'X-GM-Signature': webhookSignature(secret, body),
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      code = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) {
      error = (e as Error).name === 'TimeoutError' ? 'нет ответа за 5 с' : (e as Error).message.slice(0, 200);
    }
    const attempts = d.attempts + 1;
    if (!error) {
      await this.prisma.webhookDelivery.update({
        where: { id },
        data: { status: 'delivered', attempts, responseCode: code, error: null, deliveredAt: new Date() },
      });
      return;
    }
    const wait = WEBHOOK_RETRY_MINUTES[attempts - 1];
    await this.prisma.webhookDelivery.update({
      where: { id },
      data: {
        attempts,
        responseCode: code,
        error,
        ...(wait === undefined ? { status: 'failed' } : { nextAt: new Date(Date.now() + wait * RETRY_UNIT_MS) }),
      },
    });
  }

  @Interval('seller-webhooks', SWEEP_MS)
  async sweep() {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const due = await this.prisma.webhookDelivery.findMany({
        where: { status: 'pending', attempts: { gt: 0 }, nextAt: { lte: new Date() } },
        orderBy: { nextAt: 'asc' },
        take: 50,
        select: { id: true },
      });
      for (const d of due) await this.deliver(d.id);
    } catch (e) {
      this.logger.error(`Вебхуки: ${(e as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }
}
