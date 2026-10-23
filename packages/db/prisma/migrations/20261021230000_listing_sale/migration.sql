-- Временная скидка на лот: прежняя цена и срок. На время скидки price —
-- сниженная; срок вышел — фоновая задача возвращает прежнюю.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "sale_list_price" BIGINT,
ADD COLUMN     "sale_until" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "listings_sale_until_idx" ON "listings"("sale_until");

