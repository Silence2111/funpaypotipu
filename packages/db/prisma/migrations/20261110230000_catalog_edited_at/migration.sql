-- Каталог ведётся в консоли (часть 110). Сид запускается при каждом выкате и
-- раньше перезаписывал название, синонимы, порядок и «скрыто» у игр и
-- разделов, а поля, которых нет в коде, — удалял: правки консоли пропадали
-- при следующем выкате. Изменённое в консоли сид больше не трогает.
ALTER TABLE "games" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "categories" ADD COLUMN "edited_at" TIMESTAMP(3);
ALTER TABLE "attributes" ADD COLUMN "edited_at" TIMESTAMP(3);
