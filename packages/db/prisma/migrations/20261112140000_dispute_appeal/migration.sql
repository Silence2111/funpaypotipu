-- Арбитраж (часть 135): решение вступает в силу после окна обжалования,
-- одно обжалование — другому арбитру; журнал просмотров выдачи.
ALTER TABLE "deliveries" ADD COLUMN     "first_viewed_at" TIMESTAMP(3),
ADD COLUMN     "view_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "disputes" ADD COLUMN     "appeal_text" TEXT,
ADD COLUMN     "appealed_at" TIMESTAMP(3),
ADD COLUMN     "appealed_by" UUID,
ADD COLUMN     "executed_at" TIMESTAMP(3),
ADD COLUMN     "finalize_at" TIMESTAMP(3),
ADD COLUMN     "first_arbiter_id" UUID,
ADD COLUMN     "first_note" TEXT,
ADD COLUMN     "first_outcome" VARCHAR(10);

-- Решённые до этой части споры уже исполнены: деньги переданы сразу.
UPDATE "disputes" SET "executed_at" = "resolved_at", "finalize_at" = "resolved_at"
  WHERE "status" IN ('resolved_buyer', 'resolved_seller') AND "resolved_at" IS NOT NULL;
