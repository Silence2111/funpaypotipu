/**
 * Сигналы о сбоях (часть 130) — без внедрения зависимостей: их шлют логгер
 * (он создаётся раньше модулей), фильтр исключений и вебхуки. Приёмник
 * ставит ErrorMonitorService при запуске; до него и в юнит-тестах сигналы
 * просто пропадают.
 */
export interface OpsErrorInput {
  source: 'api' | 'web';
  message: string;
  stack?: string | null;
  context?: string | null;
  path?: string | null;
}

export type OpsEventKind = 'webhook_failed';

interface Sink {
  error(input: OpsErrorInput): void;
  event(kind: OpsEventKind): void;
}

let sink: Sink | null = null;

export function setOpsSink(s: Sink | null) {
  sink = s;
}

export function opsError(input: OpsErrorInput) {
  try {
    sink?.error(input);
  } catch {
    // Сбор ошибок не должен ронять то, что их породило.
  }
}

export function opsEvent(kind: OpsEventKind) {
  try {
    sink?.event(kind);
  } catch {
    // Как выше.
  }
}
