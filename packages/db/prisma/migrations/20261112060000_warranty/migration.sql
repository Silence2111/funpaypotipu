-- Гарантия продавца в днях (часть 126): срок у лота; у заказа — до какого
-- времени можно открыть спор после подтверждения и когда деньги переданы.
ALTER TABLE "listings" ADD COLUMN     "warranty_days" INTEGER;

ALTER TABLE "orders" ADD COLUMN     "warranty_released_at" TIMESTAMP(3),
ADD COLUMN     "warranty_until" TIMESTAMP(3);

CREATE INDEX "orders_warranty_until_idx" ON "orders"("warranty_until");
