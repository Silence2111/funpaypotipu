import { Worker, type ConnectionOptions } from 'bullmq';
import { QUEUES, type OrderAutoConfirmJob } from './queues';

const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection: ConnectionOptions = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  // BullMQ требует отключённый лимит ретраев на блокирующих командах.
  maxRetriesPerRequest: null,
};

/**
 * Воркер авто-подтверждения сделок: по таймауту переводит DELIVERED → COMPLETED
 * и инициирует релиз эскроу. Логика перехода — в сервисе заказов (Фаза 2).
 */
const autoConfirm = new Worker<OrderAutoConfirmJob>(
  QUEUES.orderAutoConfirm,
  async (job) => {
    // TODO(Фаза 2): вызвать OrderStateMachine.confirm(orderId) идемпотентно.
    console.log(`[auto-confirm] order=${job.data.orderId} (заглушка)`);
  },
  { connection },
);

autoConfirm.on('ready', () => console.log(`✅ Worker слушает очередь "${QUEUES.orderAutoConfirm}"`));
autoConfirm.on('failed', (job, err) => console.error(`❌ job ${job?.id} упал:`, err.message));

const shutdown = async () => {
  await autoConfirm.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('🛠  Worker запущен');
