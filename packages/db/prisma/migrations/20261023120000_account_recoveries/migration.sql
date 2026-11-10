-- «Не могу войти»: заявки на восстановление доступа без входа. Пишутся,
-- только если аккаунт с такой почтой есть. Сотрудник видит, какие номера
-- заказов из заявки у этого аккаунта, и отметку владельца «Заявку подал не
-- я»; решение — не раньше чем через 3 дня.

-- CreateTable
CREATE TABLE "account_recoveries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "order_numbers" TEXT[],
    "details" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "objected_at" TIMESTAMP(3),
    "objected_from" TEXT,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_recoveries_user_id_status_idx" ON "account_recoveries"("user_id", "status");

-- CreateIndex
CREATE INDEX "account_recoveries_status_created_at_idx" ON "account_recoveries"("status", "created_at");

-- AddForeignKey
ALTER TABLE "account_recoveries" ADD CONSTRAINT "account_recoveries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

