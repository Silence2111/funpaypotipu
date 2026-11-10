-- Настройки уведомлений: какие группы в какие каналы (почта, Telegram).
ALTER TABLE "users" ADD COLUMN "notify_prefs" JSONB;
