import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Request } from 'express';
import { requestLang } from '../i18n/lang';
import { localizeErrorBody } from '../i18n/translate';

/**
 * Ошибки на языке сайта. Русский запрос отвечается как раньше — тем же
 * BaseExceptionFilter, что у Nest по умолчанию. Английский — тем же
 * ответом с переведённым текстом и `lang: 'en'`; ошибка без перевода
 * уходит как есть, и сайт покажет свою английскую подпись. Ошибки не HTTP
 * (500) сюда не попадают; сокетов глобальные фильтры не касаются.
 */
@Catch(HttpException)
export class I18nExceptionFilter extends BaseExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    if (host.getType() === 'http') {
      const req = host.switchToHttp().getRequest<Request>();
      if (requestLang(req.headers['accept-language']) === 'en') {
        const status = exception.getStatus();
        const body = localizeErrorBody(exception.getResponse(), status);
        if (body) return super.catch(new HttpException(body, status), host);
      }
    }
    return super.catch(exception, host);
  }
}
