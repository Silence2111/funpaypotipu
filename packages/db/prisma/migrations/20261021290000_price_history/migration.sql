-- История цены лота: точку пишет триггер базы при создании лота и при
-- каждой смене цены или пачки — любым путём, включая возврат цены по сроку
-- скидки одним запросом. Время — в UTC, как пишет его Prisma.

-- CreateTable
CREATE TABLE "listing_price_points" (
    "id" BIGSERIAL NOT NULL,
    "listing_id" UUID NOT NULL,
    "price" BIGINT NOT NULL,
    "price_per_units" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_price_points_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_price_points_listing_id_at_idx" ON "listing_price_points"("listing_id", "at");

-- AddForeignKey
ALTER TABLE "listing_price_points" ADD CONSTRAINT "listing_price_points_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Триггер: новая точка, только если цена или пачка правда изменились.
CREATE FUNCTION listing_price_point() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR NEW.price IS DISTINCT FROM OLD.price
     OR NEW.price_per_units IS DISTINCT FROM OLD.price_per_units THEN
    INSERT INTO listing_price_points (listing_id, price, price_per_units, at)
    VALUES (NEW.id, NEW.price, NEW.price_per_units, now() AT TIME ZONE 'UTC');
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_price_history
AFTER INSERT OR UPDATE OF price, price_per_units ON listings
FOR EACH ROW EXECUTE FUNCTION listing_price_point();

-- Лотам, что уже есть, — начальная точка: прежней истории нет.
INSERT INTO listing_price_points (listing_id, price, price_per_units, at)
SELECT id, price, price_per_units, now() AT TIME ZONE 'UTC'
FROM listings
WHERE status <> 'archived';
