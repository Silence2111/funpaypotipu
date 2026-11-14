import { ConsoleLogger } from '@nestjs/common';
import { opsError } from './ops-signal';

/** Эти источники не собираем: обработчик исключений пишет сам (с адресом), сбор — о себе. */
const SKIP = new Set(['ExceptionsHandler', 'ErrorMonitorService', 'OpsAlertService']);

/**
 * Журнал API (часть 130): всё, что пишется как error — отказ шлюза, упавшая
 * фоновая задача, непойманное исключение, — уходит ещё и в сбор ошибок,
 * а оттуда в консоль «Сверка и сбои» и в тревоги.
 */
export class MonitoringLogger extends ConsoleLogger {
  error(message: unknown, ...rest: unknown[]) {
    super.error(message, ...(rest as [string?, string?]));
    let stack: string | null = message instanceof Error ? (message.stack ?? null) : null;
    let context: string | null = null;
    const strs = rest.filter((r): r is string => typeof r === 'string');
    if (strs.length >= 2) {
      stack = strs[0] ?? stack;
      context = strs[strs.length - 1] ?? null;
    } else if (strs.length === 1) {
      if (/\n\s+at /.test(strs[0]!)) stack = strs[0]!;
      else context = strs[0]!;
    }
    if (context && SKIP.has(context)) return;
    const text =
      message instanceof Error
        ? message.message
        : typeof message === 'string'
          ? message
          : JSON.stringify(message);
    opsError({ source: 'api', message: text ?? 'error', stack, context });
  }
}
