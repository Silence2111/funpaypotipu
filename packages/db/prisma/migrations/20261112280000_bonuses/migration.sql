-- Бонусы вместо кэшбэка в «Безопасной сделке» (часть 146).
-- CreateEnum
CREATE TYPE "BonusKind" AS ENUM ('accrual', 'spend', 'refund');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "bonus_discount" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "bonus_entries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "kind" "BonusKind" NOT NULL,
    "order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bonus_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bonus_entries_user_id_created_at_idx" ON "bonus_entries"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "bonus_entries_kind_order_id_key" ON "bonus_entries"("kind", "order_id");

-- AddForeignKey
ALTER TABLE "bonus_entries" ADD CONSTRAINT "bonus_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Заказ отменён, истёк или деньги вернули — списанные в нём бонусы
-- возвращаются. Триггер, а не код: путей к отмене много (покупатель,
-- продавец, таймер, арбитр, возврат исходным способом), ни один не забыт.
-- Уникальный (kind, order_id) не даёт вернуть дважды.
CREATE OR REPLACE FUNCTION order_bonus_refund() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bonus_discount" > 0
     AND NEW."status" IN ('cancelled', 'expired', 'refunded')
     AND OLD."status" IS DISTINCT FROM NEW."status" THEN
    INSERT INTO "bonus_entries" ("id", "user_id", "amount", "kind", "order_id")
    VALUES (gen_random_uuid(), NEW."buyer_id", NEW."bonus_discount", 'refund', NEW."id")
    ON CONFLICT ("kind", "order_id") DO NOTHING;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER "orders_bonus_refund"
  AFTER UPDATE OF "status" ON "orders"
  FOR EACH ROW EXECUTE FUNCTION order_bonus_refund();
