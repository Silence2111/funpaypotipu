-- Пополнение на сумму покупателя: наценка продавца и границы номинала.
-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "topup_markup_bps" INTEGER,
ADD COLUMN     "topup_max" BIGINT,
ADD COLUMN     "topup_min" BIGINT;

-- Условия задаются целиком или не задаются вовсе: лот с наценкой, но без
-- границ суммы, нельзя ни показать, ни продать. Prisma CHECK не описывает,
-- поэтому ограничение живёт только здесь.
--
-- IS NOT NULL во второй ветке обязателен: сравнение с NULL даёт «неизвестно»,
-- а CHECK пропускает «неизвестно» как истину — без них проходит наценка без границ.
ALTER TABLE "listings" ADD CONSTRAINT "listings_topup_terms_check" CHECK (
  ("topup_markup_bps" IS NULL AND "topup_min" IS NULL AND "topup_max" IS NULL)
  OR (
    "topup_markup_bps" IS NOT NULL AND "topup_min" IS NOT NULL AND "topup_max" IS NOT NULL
    AND "topup_markup_bps" >= 0 AND "topup_min" > 0 AND "topup_max" >= "topup_min"
  )
);
