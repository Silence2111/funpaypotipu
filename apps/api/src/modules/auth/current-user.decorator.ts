import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  username: string;
  /** Сеанс, из которого пришёл запрос, — чтобы не закрыть его вместе с остальными. */
  sessionFamily?: string;
}

/** Достаёт пользователя, проставленного JwtAuthGuard, из запроса. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<{ user: AuthUser }>();
    return req.user;
  },
);
