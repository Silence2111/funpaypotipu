import { Body, Controller, Headers, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';
import { OpsAlertService } from '../ops/ops-alert.service';

/** Не больше стольких сообщений в час с одного адреса и в сутки со всех — как у формы на lerti. */
const PER_HOUR = Number(process.env.CONTACT_PER_HOUR ?? 5);
const PER_DAY = Number(process.env.CONTACT_PER_DAY ?? 200);

type Fields = { imya?: unknown; svyaz?: unknown; tekst?: unknown; sait?: unknown; soglasie?: unknown };
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * Форма обращения (юрдокументы из ~/Projects/_система/юр, проекты/lutli.txt): страницу
 * /obrashchenie/ отдаёт Caddy, отправка /obrashchenie/otpravit приходит сюда
 * (`/api/obrashchenie/otpravit`). Через неё пишут о персональных данных, претензии
 * и отказ от договора — в том числе без аккаунта, поэтому это не тикет поддержки.
 * Обращение пишется в базу и уходит сотрудникам тревогой в Telegram (бот тревог).
 */
@Controller('obrashchenie')
export class ContactRequestsController {
  private readonly hits = new Map<string, number[]>();
  private day: number[] = [];

  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly alerts: OpsAlertService,
  ) {}

  @Post('otpravit')
  @HttpCode(200)
  async send(@Body() body: Fields, @Req() req: Request, @Res() res: Response, @Headers('accept') accept?: string) {
    const json = (accept ?? '').includes('application/json');
    const done = (ok: boolean, text: string) => this.answer(res, json, ok, text);
    const name = str(body?.imya).slice(0, 120);
    const contact = str(body?.svyaz);
    const text = str(body?.tekst);
    // ловушка: живой человек скрытое поле не заполняет, боту отвечаем как будто дошло
    if (str(body?.sait)) return done(true, 'Спасибо, сообщение получено.');
    if (contact.length < 3 || contact.length > 200) return done(false, 'Укажите, куда ответить: почта, телефон или ник в Telegram.');
    if (!text) return done(false, 'Напишите, о чём обращение.');
    if (text.length > 4000 || name.length > 120) return done(false, 'Сообщение слишком длинное.');
    if (str(body?.soglasie) !== 'da') return done(false, 'Отметьте согласие на обработку данных, иначе ответить не получится.');
    const ipHash = this.hash(req.ip ?? '');
    if (!this.allow(ipHash)) return done(false, 'Слишком много сообщений подряд. Попробуйте через час.');
    try {
      const row = await this.prisma.contactRequest.create({ data: { name: name || null, contact, text, ipHash } });
      await this.alerts.alert(
        `contact:${row.id.slice(0, 13)}`, // ключ тревоги — до 40 знаков (ops_alerts.key)
        `Обращение через форму на сайте\nИмя: ${name || 'не назвался'}\nКуда ответить: ${contact}\n\n${text}`,
      );
    } catch {
      return done(false, 'Сервис временно недоступен. Попробуйте позже.');
    }
    return done(true, `Ответ придёт на ${contact} в течение 10 рабочих дней, обычно раньше.`);
  }

  private hash(ip: string) {
    const salt = process.env.CONTACT_SALT || process.env.JWT_ACCESS_SECRET || '';
    return createHash('sha256').update(salt + ip).digest('hex').slice(0, 32);
  }

  private allow(key: string, now = Date.now()) {
    const mine = (this.hits.get(key) ?? []).filter((t) => now - t < 3_600_000);
    this.day = this.day.filter((t) => now - t < 86_400_000);
    if (mine.length >= PER_HOUR || this.day.length >= PER_DAY) return false;
    mine.push(now);
    this.day.push(now);
    this.hits.set(key, mine);
    return true;
  }

  private answer(res: Response, json: boolean, ok: boolean, text: string) {
    res.status(ok ? 200 : 400).setHeader('Cache-Control', 'no-store').setHeader('X-Robots-Tag', 'noindex');
    if (json) return res.json({ ok, error: ok ? '' : text });
    const title = ok ? 'Сообщение отправлено' : 'Не получилось отправить';
    return res.type('html').send(`<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${title} · Lutli</title>
<style>body{margin:0;font:17px/1.6 -apple-system,system-ui,Arial,sans-serif;background:#edf4ff;color:#131923}
.w{max-width:640px;margin:0 auto;padding:48px 16px}a{color:#1453ff}
@media (prefers-color-scheme:dark){body{background:#0b0b0c;color:#ececec}a{color:#6b91ff}}</style></head>
<body><div class="w"><h1>${title}</h1><p>${esc(text)}</p>
<p><a href="${ok ? '/' : '/obrashchenie/'}">${ok ? 'Вернуться на сайт' : 'Вернуться к форме'}</a></p></div></body></html>`);
  }
}
