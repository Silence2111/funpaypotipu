-- Подписка на продавца: его новые лоты и скидки приходят уведомлением.
-- У лота — когда началась скидка, чтобы подписчики узнали о ней один раз.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "sale_started_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "seller_follows" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "notify" BOOLEAN NOT NULL DEFAULT true,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seller_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seller_follows_seller_id_idx" ON "seller_follows"("seller_id");

-- CreateIndex
CREATE UNIQUE INDEX "seller_follows_user_id_seller_id_key" ON "seller_follows"("user_id", "seller_id");

-- AddForeignKey
ALTER TABLE "seller_follows" ADD CONSTRAINT "seller_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_follows" ADD CONSTRAINT "seller_follows_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

