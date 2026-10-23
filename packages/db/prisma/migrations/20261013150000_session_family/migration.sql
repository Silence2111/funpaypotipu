-- Семейство сеанса: вход на устройстве переживает обновление токенов.
ALTER TABLE "auth_sessions" ADD COLUMN "family_id" UUID;
UPDATE "auth_sessions" SET "family_id" = "id";
ALTER TABLE "auth_sessions" ALTER COLUMN "family_id" SET NOT NULL;
CREATE INDEX "auth_sessions_family_id_idx" ON "auth_sessions"("family_id");
