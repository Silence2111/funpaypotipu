-- «Сообщить о поступлении»: кто ждёт закончившийся лот. Фоновая задача
-- шлёт уведомление, когда лот снова в продаже, и удаляет запись.

-- CreateTable
CREATE TABLE "stock_watches" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_watches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_watches_listing_id_idx" ON "stock_watches"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_watches_user_id_listing_id_key" ON "stock_watches"("user_id", "listing_id");

-- AddForeignKey
ALTER TABLE "stock_watches" ADD CONSTRAINT "stock_watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_watches" ADD CONSTRAINT "stock_watches_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

