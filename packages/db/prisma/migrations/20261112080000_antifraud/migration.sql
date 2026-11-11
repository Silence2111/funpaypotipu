-- Защита от мошенничества (часть 128): HMAC реквизитов у заявок на вывод и
-- индексы для поиска связанных аккаунтов — общий браузер, адрес, реквизиты.
ALTER TABLE "payouts" ADD COLUMN     "destination_fp" TEXT;

CREATE INDEX "auth_sessions_device_fingerprint_idx" ON "auth_sessions"("device_fingerprint");
CREATE INDEX "auth_sessions_ip_idx" ON "auth_sessions"("ip");
CREATE INDEX "payout_destinations_fingerprint_idx" ON "payout_destinations"("fingerprint");
CREATE INDEX "payouts_destination_fp_idx" ON "payouts"("destination_fp");
