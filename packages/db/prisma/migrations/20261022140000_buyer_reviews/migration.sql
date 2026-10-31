-- Оценка покупателя продавцом после сделки: «порекомендую» или нет,
-- одна на заказ. Комментарий видит только сам покупатель.

-- CreateTable
CREATE TABLE "buyer_reviews" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "good" BOOLEAN NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyer_reviews_order_id_key" ON "buyer_reviews"("order_id");

-- CreateIndex
CREATE INDEX "buyer_reviews_buyer_id_idx" ON "buyer_reviews"("buyer_id");

-- AddForeignKey
ALTER TABLE "buyer_reviews" ADD CONSTRAINT "buyer_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_reviews" ADD CONSTRAINT "buyer_reviews_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_reviews" ADD CONSTRAINT "buyer_reviews_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

