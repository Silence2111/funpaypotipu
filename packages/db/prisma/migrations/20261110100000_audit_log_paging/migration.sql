-- Журнал по страницам: свежие записи сверху и действия одного сотрудника
-- берутся по индексу, без сортировки всего журнала.
DROP INDEX "audit_logs_actor_id_idx";

CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

CREATE INDEX "audit_logs_created_at_id_idx" ON "audit_logs"("created_at", "id");
