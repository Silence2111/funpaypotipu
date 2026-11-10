-- Очередь жалоб у модератора. Раньше она отдавала 200 жалоб по времени
-- подачи, от старых к новым, и «Решённые» показывали 200 самых первых
-- решений, а не последние. Время решения нигде не хранилось — теперь оно
-- здесь, и решённые идут свежими сверху. У прежних решённых и отклонённых
-- настоящее время решения неизвестно: берётся время подачи жалобы.
ALTER TABLE "reports" ADD COLUMN "handled_at" TIMESTAMP(3);
UPDATE "reports" SET "handled_at" = "created_at" WHERE "status" IN ('resolved', 'rejected');

-- Страницы очереди: открытые — по времени подачи, решённые — по времени
-- решения. Индекс по одному статусу эти заменяют.
DROP INDEX "reports_status_idx";
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");
CREATE INDEX "reports_status_handled_at_idx" ON "reports"("status", "handled_at");
