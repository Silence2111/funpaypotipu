-- Лот на английском (часть 144): название и описание для англоязычных покупателей.
-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "title_en" TEXT;

