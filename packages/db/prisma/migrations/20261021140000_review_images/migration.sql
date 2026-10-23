-- Фото к отзывам: ключи хранилища и их число (фильтр «С фото»).

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "images" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "photo_count" INTEGER NOT NULL DEFAULT 0;

