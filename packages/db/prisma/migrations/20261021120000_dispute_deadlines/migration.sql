-- Споры: чей ход и срок ответа, кто пропустил срок; сообщения площадки
-- в споре (sender_id = null).

-- AlterTable
ALTER TABLE "dispute_messages" ALTER COLUMN "sender_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "disputes" ADD COLUMN     "awaiting_from" VARCHAR(10),
ADD COLUMN     "missed_at" TIMESTAMP(3),
ADD COLUMN     "missed_by" VARCHAR(10),
ADD COLUMN     "respond_by" TIMESTAMP(3);

