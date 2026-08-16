import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';

const DEFAULT_MAX_SIZE = 20 * 1024 * 1024;
// EICAR-тест-строка из частей, чтобы не триггерить AV на исходнике.
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}' + '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export interface ScanResult {
  clean: boolean;
  reason?: string;
}

/**
 * Антивирус-скан вложений. Если задан CLAMAV_HOST — реальный ClamAV по протоколу
 * INSTREAM; иначе эвристика (лимит размера + сигнатура EICAR). Подключение реального
 * ClamAV = поднять clamd и задать CLAMAV_HOST, код не меняется (docs/06).
 *
 * Что делать, когда антивирус недоступен, — вопрос не технический, а про риск.
 * Раньше файл молча считался чистым (fail-open): удобно, сервис не встаёт, но
 * это ровно тот случай, когда «уронить clamd» становится способом залить
 * вредонос на маркетплейс. Поэтому в production по умолчанию fail-closed:
 * не смогли проверить — не приняли. Переопределяется `ANTIVIRUS_FAIL_MODE`,
 * если сознательно нужен обратный компромисс.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly clamHost = process.env.CLAMAV_HOST;
  private readonly clamPort = Number(process.env.CLAMAV_PORT ?? 3310);

  /** Предел размера вложения. Читаем по месту, а не при импорте модуля:
   *  иначе значение фиксируется на момент загрузки файла и не меняется
   *  ни настройкой в рантайме, ни в тестах. */
  private get maxSize(): number {
    const raw = Number(process.env.ATTACHMENT_MAX_BYTES);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_SIZE;
  }

  /** Пропускать ли непроверенный файл. В проде — нет. */
  private get failOpen(): boolean {
    const mode = (process.env.ANTIVIRUS_FAIL_MODE ?? '').trim().toLowerCase();
    if (mode === 'open') return true;
    if (mode === 'closed') return false;
    return process.env.NODE_ENV !== 'production';
  }

  private unavailable(reason: string): ScanResult {
    if (this.failOpen) {
      this.logger.warn(`Антивирус недоступен (${reason}) — файл пропущен (fail-open)`);
      return { clean: true };
    }
    this.logger.error(`Антивирус недоступен (${reason}) — файл отклонён (fail-closed)`);
    return { clean: false, reason: 'проверка антивирусом недоступна, попробуйте позже' };
  }

  async scan(bytes: Buffer): Promise<ScanResult> {
    const limit = this.maxSize;
    if (bytes.length > limit) {
      const mb = limit >= 1024 * 1024 ? `${Math.round(limit / 1024 / 1024)} МБ` : `${limit} байт`;
      return { clean: false, reason: `превышен лимит ${mb}` };
    }
    if (this.clamHost) return this.clamav(bytes);
    if (bytes.includes(EICAR)) return { clean: false, reason: 'сигнатура EICAR' };
    return { clean: true };
  }

  /** ClamAV INSTREAM: <4b size><data>...<4b zero>; ответ "stream: OK" | "... FOUND". */
  private clamav(bytes: Buffer): Promise<ScanResult> {
    return new Promise((resolve) => {
      const socket = net.connect(this.clamPort, this.clamHost);
      let resp = '';
      socket.setTimeout(5000, () => {
        socket.destroy();
        resolve(this.unavailable('таймаут'));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        const size = Buffer.alloc(4);
        size.writeUInt32BE(bytes.length, 0);
        socket.write(size);
        socket.write(bytes);
        socket.write(Buffer.from([0, 0, 0, 0]));
      });
      socket.on('data', (d) => (resp += d.toString()));
      socket.on('end', () => resolve(resp.includes('OK') ? { clean: true } : { clean: false, reason: resp.trim() }));
      socket.on('error', (e) => resolve(this.unavailable(e.message)));
    });
  }
}
