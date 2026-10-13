-- Способ оплаты и его надбавка: шлюз берёт с покупателя сумму заказа плюс
-- надбавку (карта +4.4%), в эскроу идёт сумма заказа.
ALTER TABLE "payments" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'sbp',
ADD COLUMN "surcharge" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "orders" ADD COLUMN "payment_method" TEXT,
ADD COLUMN "payment_surcharge" BIGINT NOT NULL DEFAULT 0;

-- Оплата с баланса не оставляла строки в payments: метод восстанавливается
-- по проводке оплаты, остальным оплаченным заказам — шлюз без надбавки.
UPDATE "orders" o SET "payment_method" = CASE
  WHEN EXISTS (
    SELECT 1 FROM "ledger_entries" e
    WHERE e."order_id" = o."id" AND e."ref_type" = 'order_payment_balance'
  ) THEN 'balance'
  ELSE 'sbp'
END
WHERE o."paid_at" IS NOT NULL;
