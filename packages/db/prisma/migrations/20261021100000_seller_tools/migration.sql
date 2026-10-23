-- Инструменты продавца: приветствие и автоподнятие в профиле, пометка
-- автоответа у сообщения, заготовки ответов для чата.

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "auto" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "auto_raise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "greeting_text" TEXT;

-- CreateTable
CREATE TABLE "reply_templates" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(60) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reply_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reply_templates_user_id_idx" ON "reply_templates"("user_id");

-- AddForeignKey
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

