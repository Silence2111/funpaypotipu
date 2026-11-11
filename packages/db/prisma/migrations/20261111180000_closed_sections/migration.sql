-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'review';

-- AlterEnum
ALTER TYPE "ModerationActionType" ADD VALUE 'approve';

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "closed_at" TIMESTAMP(3),
ADD COLUMN     "closed_reason" TEXT,
ADD COLUMN     "sales_closed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "paused_for_section" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "review_reason" TEXT;

-- Часть 122: в закрытом разделе лот не продаётся, каким бы путём его ни
-- возвращали в продажу (правка, снятие блокировки, конец отпуска, склад,
-- отмена заказа): лот остаётся снятым с отметкой «раздел закрыт», а
-- открытие раздела вернёт его само.
CREATE OR REPLACE FUNCTION listings_section_closed() RETURNS trigger AS $$
BEGIN
  IF NEW.status IN ('active', 'sold_out')
     AND EXISTS (SELECT 1 FROM categories c WHERE c.id = NEW.category_id AND c.sales_closed) THEN
    NEW.status := 'paused';
    NEW.paused_for_section := true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER listings_section_closed
  BEFORE INSERT OR UPDATE OF status, category_id ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listings_section_closed();

-- На запуск закрыты аккаунты и буст (ст. 13.29.2 КоАП, 281-ФЗ). Тексты —
-- `packages/shared/src/sections.ts`; разделы, изменённые в консоли, не трогаем.
UPDATE "categories" SET "sales_closed" = true, "closed_at" = now(), "closed_reason" = 'Продажа аккаунтов закрыта: покупатель получает логин и пароль продавца, а передачу данных для входа другому человеку закон ограничивает (ст. 13.29.2 КоАП). Предметы, валюту, ключи и донат продают как обычно.'
  WHERE "segment" = 'accounts' AND "edited_at" IS NULL;
UPDATE "categories" SET "sales_closed" = true, "closed_at" = now(), "closed_reason" = 'Буст закрыт: исполнителю нужен вход в аккаунт покупателя, а передачу логина и пароля другому человеку закон ограничивает (ст. 13.29.2 КоАП). Предметы, валюту, ключи и донат продают как обычно.'
  WHERE "segment" = 'service' AND ("title" LIKE '%Буст%' OR "title" LIKE '%буст%' OR "title" LIKE '%Прокачк%' OR "title" LIKE '%прокачк%') AND "edited_at" IS NULL;
UPDATE "listings" l SET "status" = 'paused', "paused_for_section" = true
  FROM "categories" c
  WHERE c."id" = l."category_id" AND c."sales_closed" AND l."status" IN ('active', 'sold_out');

