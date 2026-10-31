-- «Отпуск» продавца: снять все лоты разом и вернуть их одной кнопкой.
ALTER TABLE "profiles" ADD COLUMN "away_since" TIMESTAMP(3);
ALTER TABLE "listings" ADD COLUMN "paused_for_away" BOOLEAN NOT NULL DEFAULT false;
