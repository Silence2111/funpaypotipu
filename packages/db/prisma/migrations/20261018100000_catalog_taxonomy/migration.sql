-- Справочник игр: тип (игра, мобильная, приложение) и синонимы для поиска.
CREATE TYPE "GameKind" AS ENUM ('game', 'mobile', 'app');

ALTER TABLE "games"
  ADD COLUMN "kind" "GameKind" NOT NULL DEFAULT 'game',
  ADD COLUMN "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Общая пачка раздела валюты: цены всех лотов раздела «за 1 000 золота».
ALTER TABLE "categories"
  ADD COLUMN "unit_name" TEXT,
  ADD COLUMN "price_per_units" INTEGER;
