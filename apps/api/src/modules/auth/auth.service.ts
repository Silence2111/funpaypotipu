import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaClient } from '@gamemarket/db';
import type { AuthResponse, LoginInput, RegisterInput } from '@gamemarket/shared';
import { PRISMA } from '../../prisma/prisma.module';

@Injectable()
export class AuthService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async register(input: RegisterInput): Promise<AuthResponse> {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ email: input.email }, { profile: { username: input.username } }] },
    });
    if (exists) throw new ConflictException('Пользователь с таким email или username уже есть');

    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        profile: { create: { username: input.username, displayName: input.username } },
      },
      include: { profile: true },
    });

    return this.toAuthResponse(user.id, user.email, user.profile!.username);
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { profile: true },
    });
    if (!user?.passwordHash || !user.profile) throw new UnauthorizedException('Неверные данные');

    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Неверные данные');

    return this.toAuthResponse(user.id, user.email, user.profile.username);
  }

  // TODO(Фаза 1): выдача реального JWT (access+refresh), ротация, httpOnly cookie. См. docs/09.
  private toAuthResponse(id: string, email: string | null, username: string): AuthResponse {
    return { user: { id, email, username }, accessToken: `stub.${id}` };
  }
}
