-- Поддержка (часть 138): первый ответ, эскалация, оценка ответа; общие
-- заготовки ответов сотрудников.
ALTER TABLE "support_tickets" ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "first_reply_at" TIMESTAMP(3),
ADD COLUMN     "rated_at" TIMESTAMP(3),
ADD COLUMN     "rating" SMALLINT,
ADD COLUMN     "rating_comment" TEXT;

CREATE TABLE "support_templates" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_templates_pkey" PRIMARY KEY ("id")
);

-- Уже отвеченные обращения: первый ответ — первое сообщение сотрудника.
UPDATE "support_tickets" t SET "first_reply_at" = m.first
  FROM (SELECT "ticket_id", min("created_at") AS first FROM "support_messages" WHERE "from_staff" GROUP BY "ticket_id") m
  WHERE m."ticket_id" = t."id";
