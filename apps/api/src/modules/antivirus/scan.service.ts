import { Injectable, Logger } from '@nestjs/common';
import * as net from 'node:net';

const MAX_SIZE = Number(process.env.ATTACHMENT_MAX_BYTES ?? 20 * 1024 * 1024);
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
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);
  private readonly clamHost = process.env.CLAMAV_HOST;
  private readonly clamPort = Number(process.env.CLAMAV_PORT ?? 3310);

  async scan(bytes: Buffer): Promise<ScanResult> {
    if (bytes.length > MAX_SIZE) {
      return { clean: false, reason: `превышен лимит ${Math.round(MAX_SIZE / 1024 / 1024)} МБ` };
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
        this.logger.warn('ClamAV timeout — файл пропущен (fail-open)');
        resolve({ clean: true });
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
      socket.on('error', (e) => {
        this.logger.warn(`ClamAV недоступен (${e.message}) — файл пропущен (fail-open)`);
        resolve({ clean: true });
      });
    });
  }
}
