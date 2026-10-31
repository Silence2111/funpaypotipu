-- Ответ в чат из Telegram: какое сообщение бота к какому диалогу на сайте
-- относится и чей это Telegram. Ответить можно 7 дней.

-- CreateTable
CREATE TABLE "telegram_replies" (
    "chat_id" TEXT NOT NULL,
    "message_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_replies_pkey" PRIMARY KEY ("chat_id","message_id")
);

-- CreateIndex
CREATE INDEX "telegram_replies_created_at_idx" ON "telegram_replies"("created_at");

