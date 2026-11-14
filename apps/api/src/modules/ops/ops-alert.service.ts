import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

/** Не чаще раза в столько минут на одну тревогу; зависшие выплаты — раз в 6 ч. */
const REPEAT_MIN: Record<string, number> = { payouts: 360 };
const repeatMin = (key: string) =>
  REPEAT_MIN[key] ?? Number(process.env.OPS_ALERT_REPEAT_MIN ?? 30);

/**
 * Тревоги (части 129–130): строка в базе — её видно в консоли «Сверка и
 * сбои», — и сообщение в Telegram тем же ботом и в тот же чат, что у
 * сторожа (`ALERT_BOT_TOKEN`, `ALERT_CHAT_ID`, infra/ops/healthwatch.sh).
 * Одна и та же тревога не повторяется чаще, чем раз в полчаса: всплеск
 * ошибок не превращается в сотню сообщений.
 */
@Injectable()
export class OpsAlertService {
  private readonly logger = new Logger(OpsAlertService.name);

  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  private get api(): string {
    const test = process.env.NODE_ENV !== 'production' ? process.env.TELEGRAM_API_URL : undefined;
    return (test ?? 'https://api.telegram.org').replace(/\/$/, '');
  }

  /** true — тревога записана (и, если настроен Telegram, отправлена); false — повтор, промолчали. */
  async alert(key: string, text: string, now = new Date()): Promise<boolean> {
    const since = new Date(now.getTime() - repeatMin(key) * 60_000);
    const recent = await this.prisma.opsAlert.findFirst({
      where: { key, createdAt: { gt: since } },
      select: { id: true },
    });
    if (recent) return false;
    const row = await this.prisma.opsAlert.create({ data: { key, text } });
    this.logger.warn(`Тревога ${key}: ${text}`);
    if (await this.send(text))
      await this.prisma.opsAlert.update({ where: { id: row.id }, data: { sent: true } });
    return true;
  }

  private async send(text: string): Promise<boolean> {
    const token = process.env.ALERT_BOT_TOKEN;
    const chat = process.env.ALERT_CHAT_ID;
    if (!token || !chat) return false;
    const site = process.env.PUBLIC_URL ?? process.env.WEB_URL ?? '';
    try {
      const res = await fetch(`${this.api}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chat,
          text: `GameMarket ${site}: ${text}`.slice(0, 4000),
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      return res.ok;
    } catch {
      // Не logger.error: ошибка ушла бы в сбор ошибок и снова в тревогу.
      this.logger.warn('Telegram не ответил на тревогу');
      return false;
    }
  }

  recent(limit = 30) {
    return this.prisma.opsAlert.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  }
}
