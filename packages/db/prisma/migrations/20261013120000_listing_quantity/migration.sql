-- Продажа поштучно: цена за пачку единиц, минимум за заказ, наличие.
-- Заказ на несколько штук получает несколько ключей со склада.

-- DropIndex
DROP INDEX "digital_goods_reserved_for_order_id_key";

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "min_qty" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "price_per_units" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "unit_name" TEXT;

-- CreateIndex
CREATE INDEX "digital_goods_reserved_for_order_id_idx" ON "digital_goods"("reserved_for_order_id");

-- Наличие списывается условным UPDATE и в минус уйти не должно. Старые данные
-- приводим к нулю до ограничения, иначе миграция упала бы на живой базе.
UPDATE "listings" SET "stock" = 0 WHERE "stock" < 0;

ALTER TABLE "listings" ADD CONSTRAINT "listings_quantity_check" CHECK (
  "price_per_units" >= 1 AND "min_qty" >= 1 AND ("stock" IS NULL OR "stock" >= 0)
);
