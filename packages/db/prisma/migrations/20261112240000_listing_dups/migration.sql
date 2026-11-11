-- Чистая выдача (часть 143): одинаковые лоты продавца в разделе — одной
-- карточкой. Повтор = тот же продавец, раздел, название без регистра, знаков
-- и эмодзи и те же параметры. Группу пересчитывает триггер базы на любое
-- изменение названия, параметров, статуса, цены, раздела — так не пропустится
-- ни одно место, где лот уходит из продажи или возвращается.

-- AlterTable
ALTER TABLE "listings" ADD COLUMN     "dup_key" TEXT,
ADD COLUMN     "dup_of" UUID;

-- CreateIndex
CREATE INDEX "listings_seller_id_category_id_dup_key_idx" ON "listings"("seller_id", "category_id", "dup_key");

-- Ключ повтора. Кириллица переводится в строчные через translate, а не
-- lower(): lower() в локали C её не трогает. Ё = Е. Остаются только цифры,
-- латиница и кириллица; короче трёх знаков — не ключ (название из эмодзи).
CREATE OR REPLACE FUNCTION listing_dup_key(t TEXT, attrs JSONB) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN length(k) >= 3 THEN k || ':' || md5(coalesce(attrs, '{}'::jsonb)::text) END
  FROM (
    SELECT regexp_replace(
      lower(translate(t, 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯё', 'абвгдеежзийклмнопрстуфхцчшщъыьэюяе')),
      '[^0-9a-zа-я]+', '', 'g'
    ) AS k
  ) s
$$;

-- Пересчёт группы: в продаже — самый дешёвый (при равной цене — старший),
-- остальные ссылаются на него; не в продаже — без ссылки.
CREATE OR REPLACE FUNCTION listing_dup_regroup(p_seller UUID, p_category UUID, p_key TEXT) RETURNS VOID
LANGUAGE plpgsql AS $$
BEGIN
  IF p_key IS NULL THEN
    RETURN;
  END IF;
  UPDATE "listings" l SET "dup_of" = g.rep
  FROM (
    SELECT "id",
      CASE WHEN "status" = 'active' THEN
        NULLIF(first_value("id") OVER (PARTITION BY ("status" = 'active') ORDER BY "price", "created_at", "id"), "id")
      END AS rep
    FROM "listings"
    WHERE "seller_id" = p_seller AND "category_id" = p_category AND "dup_key" = p_key
  ) g
  WHERE l."id" = g."id" AND l."dup_of" IS DISTINCT FROM g.rep;
END
$$;

-- До записи: ключ из названия и параметров.
CREATE OR REPLACE FUNCTION listing_dup_key_trg() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW."dup_key" := listing_dup_key(NEW."title", NEW."attributes"::jsonb);
  IF NEW."dup_key" IS NULL THEN
    NEW."dup_of" := NULL;
  END IF;
  RETURN NEW;
END
$$;

-- После записи: пересчёт прежней и новой группы. Пересчёт меняет только
-- dup_of — его нет в списке столбцов, повторно триггер не срабатывает.
CREATE OR REPLACE FUNCTION listing_dup_group_trg() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM listing_dup_regroup(OLD."seller_id", OLD."category_id", OLD."dup_key");
  END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND (NEW."seller_id", NEW."category_id", NEW."dup_key") IS DISTINCT FROM (OLD."seller_id", OLD."category_id", OLD."dup_key")) THEN
    PERFORM listing_dup_regroup(NEW."seller_id", NEW."category_id", NEW."dup_key");
  END IF;
  RETURN NULL;
END
$$;

-- Заполнение для лотов, что уже есть, — до триггеров, одним проходом.
UPDATE "listings" SET "dup_key" = listing_dup_key("title", "attributes"::jsonb);
UPDATE "listings" l SET "dup_of" = g.rep
FROM (
  SELECT "id", NULLIF(first_value("id") OVER (PARTITION BY "seller_id", "category_id", "dup_key" ORDER BY "price", "created_at", "id"), "id") AS rep
  FROM "listings"
  WHERE "status" = 'active' AND "dup_key" IS NOT NULL
) g
WHERE l."id" = g."id" AND g.rep IS NOT NULL;

CREATE TRIGGER "listings_dup_key"
  BEFORE INSERT OR UPDATE OF "title", "attributes" ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listing_dup_key_trg();

CREATE TRIGGER "listings_dup_group"
  AFTER INSERT OR DELETE OR UPDATE OF "title", "attributes", "status", "price", "category_id", "seller_id" ON "listings"
  FOR EACH ROW EXECUTE FUNCTION listing_dup_group_trg();
