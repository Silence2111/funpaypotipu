-- Честная скидка: «−20%» считается от самой низкой цены за 7 дней до
-- скидки, а не от цены, поднятой накануне. Идущим скидкам — их прежняя цена.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "sale_ref_price" BIGINT;


UPDATE "listings" SET "sale_ref_price" = "sale_list_price" WHERE "sale_until" IS NOT NULL;
