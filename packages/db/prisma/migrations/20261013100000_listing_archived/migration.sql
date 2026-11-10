-- Лот с заказами не удаляется, а уходит в архив: заказы ссылаются на него
-- внешним ключом, и удаление падало с ошибкой.
-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'archived';
