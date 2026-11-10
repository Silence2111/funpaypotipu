-- Просмотры лота по дням для статистики продавца. Раньше views_count у лота
-- не увеличивался ничем — просмотров не было видно вовсе.

-- CreateTable
CREATE TABLE "listing_view_days" (
    "listing_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "listing_view_days_pkey" PRIMARY KEY ("listing_id","day")
);

-- CreateIndex
CREATE INDEX "listing_view_days_day_idx" ON "listing_view_days"("day");

-- AddForeignKey
ALTER TABLE "listing_view_days" ADD CONSTRAINT "listing_view_days_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

