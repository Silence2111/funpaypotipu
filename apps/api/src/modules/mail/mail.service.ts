import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

/**
 * Отправка e-mail через SMTP (nodemailer). Локально — MailHog, в проде — боевой SMTP.
 * Если SMTP_HOST не задан — почта выключена (enabled=false), вызовы — no-op.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from = process.env.SMTP_FROM ?? 'no-reply@gamemarket.local';

  constructor() {
    const host = process.env.SMTP_HOST;
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(process.env.SMTP_PORT ?? 1025),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER
            ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
            : undefined,
        })
      : null;
  }

  get enabled(): boolean {
    return this.transporter !== null;
  }

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    if (!this.transporter) return;
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, text, html });
    } catch (e) {
      this.logger.warn(`Не удалось отправить письмо на ${to}: ${(e as Error).message}`);
    }
  }
}
