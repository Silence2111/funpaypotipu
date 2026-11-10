import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Get()
  async check() {
    let db = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return { status: 'ok', db, ts: new Date().toISOString() };
  }

  /**
   * Готовность принимать запросы — для readinessProbe. /health отвечает 200,
   * даже когда база недоступна (процесс жив, перезапускать незачем); сюда
   * трафик пускать нельзя: каждый запрос упадёт.
   */
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('База данных недоступна');
    }
    return { status: 'ready' };
  }
}
