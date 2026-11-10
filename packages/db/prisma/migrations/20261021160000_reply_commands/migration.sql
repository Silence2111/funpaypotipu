-- Автоответы на команды: у заготовки — команда («!оплата»), по которой она
-- уходит покупателю сама; у продавца команды не повторяются.
-- «Обычно отвечает за …»: последние живые ответы продавца — когда и сколько
-- покупатель ждал, в секундах.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "reply_samples" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "reply_templates" ADD COLUMN     "command" VARCHAR(40);

-- CreateIndex
CREATE UNIQUE INDEX "reply_templates_user_id_command_key" ON "reply_templates"("user_id", "command");
