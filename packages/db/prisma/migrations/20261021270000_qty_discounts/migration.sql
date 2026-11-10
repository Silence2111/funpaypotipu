-- Скидка за количество у поштучного лота: ступени «от N единиц — X%».

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "qty_discounts" JSONB;

