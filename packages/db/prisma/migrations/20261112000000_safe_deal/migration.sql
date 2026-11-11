-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deal_id" TEXT;

-- CreateTable
CREATE TABLE "deal_payouts" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "deal_id" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'waiting',
    "method" VARCHAR(16),
    "destination_id" UUID,
    "external_id" TEXT,
    "failure_reason" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deal_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deal_payouts_order_id_key" ON "deal_payouts"("order_id");

-- CreateIndex
CREATE INDEX "deal_payouts_seller_id_status_idx" ON "deal_payouts"("seller_id", "status");

-- CreateIndex
CREATE INDEX "deal_payouts_status_updated_at_idx" ON "deal_payouts"("status", "updated_at");

-- AddForeignKey
ALTER TABLE "deal_payouts" ADD CONSTRAINT "deal_payouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

