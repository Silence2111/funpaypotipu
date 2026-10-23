-- Язык писем, Telegram и пушей: последний язык сайта при входе или выбранный
-- в переключателе. У всех, кто был до этого, — русский.
ALTER TABLE "users" ADD COLUMN     "locale" VARCHAR(5) NOT NULL DEFAULT 'ru';
