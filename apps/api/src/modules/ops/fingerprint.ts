import { createHash } from 'node:crypto';

/**
 * Отпечаток ошибки (часть 130): одна группа на вид ошибки, а не на каждый
 * случай. Из текста убираются id, числа, суммы и почты — «Заказ 7f3a… не
 * найден» и «Заказ 91bc… не найден» — одна группа. Плюс первая строка стека
 * из нашего кода: одинаковый текст из разных мест — разные группы.
 */
export function normalizeMessage(message: string): string {
  return message
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\d+(?:[.,]\d+)?/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Первая строка стека из нашего кода (не node_modules), без номера колонки. */
export function topFrame(stack: string | null | undefined): string {
  if (!stack) return '';
  const line = stack
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .find(
      (l) => l.startsWith('at ') && !l.includes('node_modules') && !l.includes('node:internal'),
    );
  return (line ?? '').replace(/:\d+\)?$/, '').replace(/\(.*[/\\](src|dist)[/\\]/, '($1/');
}

export function fingerprint(
  source: string,
  message: string,
  stack?: string | null,
  context?: string | null,
): string {
  return createHash('sha256')
    .update([source, context ?? '', normalizeMessage(message), topFrame(stack)].join('\n'))
    .digest('hex');
}
