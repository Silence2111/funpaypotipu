-- Выплаты через шлюз: номер выплаты у ЮKassa и причина, если шлюз не выплатил.
-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "external_id" TEXT,
ADD COLUMN     "failure_reason" TEXT;
