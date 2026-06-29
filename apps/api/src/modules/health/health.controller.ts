import { Controller, Get, Inject } from '@nestjs/common';
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
}
