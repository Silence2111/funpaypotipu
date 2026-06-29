export * from '@prisma/client';
import { PrismaClient } from '@prisma/client';

/**
 * Единый экземпляр PrismaClient на процесс.
 * В dev переживает hot-reload через global, чтобы не плодить соединения.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
