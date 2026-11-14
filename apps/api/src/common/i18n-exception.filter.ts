import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { requestLang } from '../i18n/lang';
import { localizeErrorBody } from '../i18n/translate';
import { opsError } from '../modules/ops/ops-signal';

/**
 * Ошибки на языке сайта. Русский запрос отвечается как раньше — тем же
 * BaseExceptionFilter, что у Nest по умолчанию. Английский — тем же
 * ответом с переведённым текстом и `lang: 'en'`; ошибка без перевода
 * уходит как есть, и сайт покажет свою английскую подпись. Сокетов
 * глобальные фильтры не касаются.
 *
 * Ловит всё: непойманное исключение и ответ 5xx уходят ещё и в сбор ошибок
 * (часть 130) — с адресом запроса. Ответ клиенту от этого не меняется.
 */
@Catch()
export class I18nExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.getType() === 'http';
    const req = http ? host.switchToHttp().getRequest<Request>() : null;
    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      const e = exception instanceof Error ? exception : new Error(String(exception));
      opsError({
        source: 'api',
        message: e.message,
        stack: e.stack ?? null,
        context: exception instanceof HttpException ? `HTTP ${exception.getStatus()}` : e.name,
        path: req
          ? `${req.method} ${(req.route as { path?: string } | undefined)?.path ?? req.path}`
          : null,
      });
    }
    if (!(exception instanceof HttpException)) return super.catch(exception, host);
    if (req && requestLang(req.headers['accept-language']) === 'en') {
      const status = exception.getStatus();
      const body = localizeErrorBody(exception.getResponse(), status);
      if (body) return super.catch(new HttpException(body, status), host);
    }
    return super.catch(exception, host);
  }
}
