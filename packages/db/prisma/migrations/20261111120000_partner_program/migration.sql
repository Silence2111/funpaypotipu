-- Партнёрская программа (часть 116): механизм без цифр. Доля и срок — в
-- system_settings (partner_program), по умолчанию выключена.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "referred_at" TIMESTAMP(3),
ADD COLUMN     "referred_by_id" UUID;

-- CreateTable
CREATE TABLE "partners" (
    "user_id" UUID NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "partner_click_days" (
    "partner_id" UUID NOT NULL,
    "day" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "partner_click_days_pkey" PRIMARY KEY ("partner_id","day")
);

-- CreateTable
CREATE TABLE "partner_accruals" (
    "id" UUID NOT NULL,
    "partner_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "referred_id" UUID NOT NULL,
    "role" VARCHAR(8) NOT NULL,
    "net" BIGINT NOT NULL,
    "share_bps" INTEGER NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_accruals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partners_code_key" ON "partners"("code");

-- CreateIndex
CREATE UNIQUE INDEX "partner_accruals_order_id_key" ON "partner_accruals"("order_id");

-- CreateIndex
CREATE INDEX "partner_accruals_partner_id_created_at_idx" ON "partner_accruals"("partner_id", "created_at");

-- CreateIndex
CREATE INDEX "users_referred_by_id_idx" ON "users"("referred_by_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_id_fkey" FOREIGN KEY ("referred_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_click_days" ADD CONSTRAINT "partner_click_days_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_accruals" ADD CONSTRAINT "partner_accruals_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_accruals" ADD CONSTRAINT "partner_accruals_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

