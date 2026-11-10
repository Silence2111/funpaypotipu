-- Платное продвижение лота с баланса продавца.
ALTER TABLE "listings" ADD COLUMN "promoted_until" TIMESTAMP(3);
