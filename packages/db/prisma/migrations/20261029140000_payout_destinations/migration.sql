-- Сохранённые реквизиты для вывода: зашифрованы, повтор отсекается по HMAC-отпечатку.

-- CreateTable
CREATE TABLE "payout_destinations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "method" TEXT NOT NULL,
    "destination_enc" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_destinations_user_id_last_used_at_idx" ON "payout_destinations"("user_id", "last_used_at");

-- CreateIndex
CREATE UNIQUE INDEX "payout_destinations_user_id_fingerprint_key" ON "payout_destinations"("user_id", "fingerprint");

-- AddForeignKey
ALTER TABLE "payout_destinations" ADD CONSTRAINT "payout_destinations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

