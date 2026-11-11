-- Правила «нарушение → санкция» (часть 140): пункт правил у решения
-- арбитра и доля возврата покупателю — частичный возврат.
ALTER TABLE "disputes" ADD COLUMN     "refund_pct" SMALLINT,
ADD COLUMN     "rule" TEXT;
