-- Промокоды продавца: скидка за его счёт, один раз на покупателя;
-- использования — по заказам, отменённые не считаются.

-- CreateTable
CREATE TABLE "seller_promos" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "percent" INTEGER NOT NULL,
    "max_uses" INTEGER,
    "valid_until" TIMESTAMP(3),
    "repeat_only" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_promos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_promo_uses" (
    "id" UUID NOT NULL,
    "promo_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "discount" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_promo_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seller_promos_seller_id_code_key" ON "seller_promos"("seller_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "seller_promo_uses_order_id_key" ON "seller_promo_uses"("order_id");

-- CreateIndex
CREATE INDEX "seller_promo_uses_promo_id_buyer_id_idx" ON "seller_promo_uses"("promo_id", "buyer_id");

-- AddForeignKey
ALTER TABLE "seller_promos" ADD CONSTRAINT "seller_promos_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_promo_uses" ADD CONSTRAINT "seller_promo_uses_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "seller_promos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_promo_uses" ADD CONSTRAINT "seller_promo_uses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

