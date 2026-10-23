/**
 * Автоответы на команды и «обычно отвечает за …».
 *
 * Команда — как у бота FunPayCardinal: покупатель пишет «!оплата», и
 * заготовка с этой командой уходит сама. Сравнивается сообщение целиком,
 * без учёта регистра, лишних пробелов и разницы «ё/е»: команда внутри
 * длинного сообщения ответа не вызывает, иначе бот отвечает невпопад.
 *
 * Время ответа — вместо «вечного онлайна», которым продавцы FunPay держат
 * зелёную точку, когда их нет у экрана. Считается по живым ответам продавца:
 * от первого сообщения покупателя, оставшегося без ответа, до ответа.
 * Автоответы не в счёт. Медиана последних ответов за два месяца, если их
 * хотя бы три; ночное ожидание учитывается не дольше суток.
 */

/** Команда — короткое слово, а не фраза. */
export const COMMAND_MAX = 40;
/** Сколько последних ответов хранится у продавца. */
export const REPLY_SAMPLES = 20;
export const REPLY_WINDOW_DAYS = 60;
/** Меньше трёх ответов — цифра случайна, её не показываем. */
export const REPLY_MIN_SAMPLES = 3;
export const REPLY_CAP_SEC = 24 * 3600;

/** [когда ответил — секунды Unix, сколько ждал покупатель — секунды]. */
export type ReplySample = [number, number];

/** За сколько обычно отвечает: до 5 и 15 минут, часа, трёх часов, дольше. */
export type ReplyTime = 'min5' | 'min15' | 'hour' | 'hours3' | 'day';

export function normalizeCommand(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

const isSample = (x: unknown): x is ReplySample =>
  Array.isArray(x) && x.length === 2 && Number.isFinite(x[0]) && Number.isFinite(x[1]);

const samplesOf = (raw: unknown): ReplySample[] => (Array.isArray(raw) ? raw.filter(isSample) : []);

/** Новый ответ — в начало, хранятся последние REPLY_SAMPLES. */
export function addReplySample(raw: unknown, at: Date, waitedSec: number): ReplySample[] {
  const waited = Math.min(Math.max(0, Math.round(waitedSec)), REPLY_CAP_SEC);
  const sample: ReplySample = [Math.floor(at.getTime() / 1000), waited];
  return [sample, ...samplesOf(raw)].slice(0, REPLY_SAMPLES);
}

export function replyTime(raw: unknown, now = Date.now()): ReplyTime | null {
  const since = now / 1000 - REPLY_WINDOW_DAYS * 86400;
  const waits = samplesOf(raw)
    .filter(([at]) => at >= since)
    .map(([, waited]) => waited)
    .sort((a, b) => a - b);
  if (waits.length < REPLY_MIN_SAMPLES) return null;
  const mid = waits.length >> 1;
  const median = waits.length % 2 ? waits[mid]! : (waits[mid - 1]! + waits[mid]!) / 2;
  if (median <= 5 * 60) return 'min5';
  if (median <= 15 * 60) return 'min15';
  if (median <= 3600) return 'hour';
  if (median <= 3 * 3600) return 'hours3';
  return 'day';
}
