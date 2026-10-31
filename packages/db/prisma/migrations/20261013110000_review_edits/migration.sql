-- Отзыв можно изменить в первые 14 дней; продавец отвечает на отзыв.
-- AlterTable
ALTER TABLE "reviews" ADD COLUMN "edited_at" TIMESTAMP(3),
ADD COLUMN "replied_at" TIMESTAMP(3);
