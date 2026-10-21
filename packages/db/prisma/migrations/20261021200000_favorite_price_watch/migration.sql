-- Снижение цены в избранном: цена за единицу при добавлении («было») и
-- последняя, о которой сообщили. Лоты «на сумму покупателя» не отслеживаются.

-- AlterTable
ALTER TABLE "favorites" ADD COLUMN     "added_unit_price" DECIMAL(24,6),
ADD COLUMN     "watch_unit_price" DECIMAL(24,6);


-- Уже добавленные в избранное — от текущей цены: о прошлых снижениях не сообщаем.
UPDATE "favorites" f
SET "added_unit_price" = l."price"::numeric / l."price_per_units",
    "watch_unit_price" = l."price"::numeric / l."price_per_units"
FROM "listings" l
WHERE l."id" = f."listing_id" AND l."topup_markup_bps" IS NULL;
