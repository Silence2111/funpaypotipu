import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { PrismaClient } from '@gamemarket/db';
import { PRISMA } from '../../prisma/prisma.module';

/**
 * Можно ли пользователю двигать деньги и товар. Заморозка — режим проверки:
 * войти и довести текущие сделки можно, а покупать, выставлять лоты и
 * выводить нельзя. Бан отсекается раньше, в JwtAuthGuard.
 */
@Injectable()
export class AccountStatusService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async assertCanTrade(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { status: true } });
    if (user?.status === 'frozen') {
      throw new ForbiddenException(
        'Аккаунт заморожен модератором: покупки, продажи и вывод недоступны. Напишите в поддержку.',
      );
    }
    if (user?.status === 'banned') throw new ForbiddenException('Аккаунт заблокирован');
  }
}
