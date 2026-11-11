-- Общий чат игры (часть 133): сообщения с отпечатком для повторов,
-- удаление сотрудником с причиной; запрет писать в чат — у профиля.
-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "chat_mute_reason" TEXT,
ADD COLUMN     "chat_muted_until" TIMESTAMP(3);
-- CreateTable
CREATE TABLE "game_chat_messages" (
    "id" UUID NOT NULL,
    "game_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" UUID,
    "delete_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_chat_messages_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "game_chat_messages_game_id_created_at_idx" ON "game_chat_messages"("game_id", "created_at");
-- CreateIndex
CREATE INDEX "game_chat_messages_user_id_created_at_idx" ON "game_chat_messages"("user_id", "created_at");
-- CreateIndex
CREATE INDEX "game_chat_messages_created_at_idx" ON "game_chat_messages"("created_at");
-- AddForeignKey
ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "game_chat_messages" ADD CONSTRAINT "game_chat_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
