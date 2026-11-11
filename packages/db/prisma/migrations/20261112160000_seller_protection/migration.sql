-- Защита продавца (часть 136): фильтр покупателей у продавца и отметка
-- покупателя «данные получены» при ручной выдаче.
ALTER TABLE "profiles" ADD COLUMN     "buyer_filter" JSONB;

ALTER TABLE "orders" ADD COLUMN     "received_at" TIMESTAMP(3);
