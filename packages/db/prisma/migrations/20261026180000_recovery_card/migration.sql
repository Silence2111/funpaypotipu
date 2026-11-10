-- «Не могу войти» по карте: проверочный платёж 1 ₽ без списания картой,
-- которой платили в аккаунте или на которую выводили деньги. У платежей —
-- карта от ЮKassa (первые 6 и последние 4 цифры, тип, срок, без номера);
-- у заявки — когда попросили, id проверочного платежа и итог сверки.

-- AlterTable
ALTER TABLE "account_recoveries" ADD COLUMN     "card_checked_at" TIMESTAMP(3),
ADD COLUMN     "card_payment_id" TEXT,
ADD COLUMN     "card_requested_at" TIMESTAMP(3),
ADD COLUMN     "card_result" JSONB;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "card" JSONB;

