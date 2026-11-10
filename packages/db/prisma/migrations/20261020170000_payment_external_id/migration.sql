-- Номер платежа у шлюза (у ЮKassa — id платежа): сверка и поиск в его кабинете.
ALTER TABLE "payments" ADD COLUMN     "external_id" TEXT;
