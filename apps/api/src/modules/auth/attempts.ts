/**
 * Защита от подбора: после `max` неудачных попыток за окно — пауза до конца
 * окна. Счётчик в памяти процесса: на нескольких репликах лимит умножается
 * на их число, но перебор пароля или кода по сети перестаёт быть быстрым.
 */
export class AttemptLimiter {
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Сколько минут ждать; 0 — можно пробовать. */
  wait(key: string, now = Date.now()): number {
    const f = this.fails.get(key);
    if (!f || f.until <= now || f.count < this.max) return 0;
    return Math.ceil((f.until - now) / 60_000);
  }

  fail(key: string, now = Date.now()): void {
    const f = this.fails.get(key);
    if (f && f.until > now) {
      f.count += 1;
      return;
    }
    if (this.fails.size > 10_000) {
      for (const [k, v] of this.fails) if (v.until <= now) this.fails.delete(k);
    }
    this.fails.set(key, { count: 1, until: now + this.windowMs });
  }

  reset(key: string): void {
    this.fails.delete(key);
  }
}
