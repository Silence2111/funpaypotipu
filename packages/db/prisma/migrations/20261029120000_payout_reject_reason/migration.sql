-- Почему сотрудник отклонил заявку на вывод: продавец видит причину в кошельке и уведомлении.

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "reject_reason" TEXT;
