-- Запросы покупателей «Хочу купить» (часть 115): что и до какой цены в разделе
-- игры; продавцам раздела — уведомление, ответ — своим лотом.
-- CreateEnum
CREATE TYPE "BuyRequestStatus" AS ENUM ('open', 'closed', 'removed');

-- CreateTable
CREATE TABLE "buy_requests" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "text" VARCHAR(300) NOT NULL,
    "max_price" BIGINT,
    "status" "BuyRequestStatus" NOT NULL DEFAULT 'open',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "notified_at" TIMESTAMP(3),
    "notified_count" INTEGER NOT NULL DEFAULT 0,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buy_request_offers" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buy_request_offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "buy_requests_category_id_status_expires_at_idx" ON "buy_requests"("category_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "buy_requests_buyer_id_created_at_idx" ON "buy_requests"("buyer_id", "created_at");

-- CreateIndex
CREATE INDEX "buy_requests_status_notified_at_idx" ON "buy_requests"("status", "notified_at");

-- CreateIndex
CREATE INDEX "buy_request_offers_request_id_seller_id_idx" ON "buy_request_offers"("request_id", "seller_id");

-- CreateIndex
CREATE INDEX "buy_request_offers_seller_id_idx" ON "buy_request_offers"("seller_id");

-- CreateIndex
CREATE INDEX "buy_request_offers_listing_id_idx" ON "buy_request_offers"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "buy_request_offers_request_id_listing_id_key" ON "buy_request_offers"("request_id", "listing_id");

-- AddForeignKey
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buy_requests" ADD CONSTRAINT "buy_requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buy_request_offers" ADD CONSTRAINT "buy_request_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "buy_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buy_request_offers" ADD CONSTRAINT "buy_request_offers_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buy_request_offers" ADD CONSTRAINT "buy_request_offers_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

