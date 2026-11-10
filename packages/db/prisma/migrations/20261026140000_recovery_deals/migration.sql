-- «Не могу войти» без доступа к почте и без проверки личности: заявитель
-- описывает сделки по ссылке на новую почту, другая сторона каждой сделки
-- отвечает, совпадает ли описание. Подтверждение с того же IP, что заявка
-- или описания, не считается — поэтому IP описаний хранится в заявке.

-- AlterTable
ALTER TABLE "account_recoveries" ADD COLUMN     "deals_at" TIMESTAMP(3),
ADD COLUMN     "deals_ip" TEXT,
ADD COLUMN     "deals_requested_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "recovery_deals" (
    "id" UUID NOT NULL,
    "recovery_id" UUID NOT NULL,
    "counterparty" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "counterparty_id" UUID,
    "answer" TEXT,
    "answered_at" TIMESTAMP(3),
    "answer_ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recovery_deals_recovery_id_idx" ON "recovery_deals"("recovery_id");

-- CreateIndex
CREATE INDEX "recovery_deals_counterparty_id_answer_idx" ON "recovery_deals"("counterparty_id", "answer");

-- AddForeignKey
ALTER TABLE "recovery_deals" ADD CONSTRAINT "recovery_deals_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "account_recoveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

