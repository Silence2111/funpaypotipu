-- Пользователи и лоты в консоли — по страницам, со счётчиками и поиском.
-- Свежие сверху и одного статуса берутся по индексу, без сортировки всей
-- таблицы; счётчики по статусам — по индексу статуса. Часть почты и
-- названия ищется по триграммам (pg_trgm — из orders_search_trgm), ник —
-- по profiles_username_trgm_idx. Индекс по одному статусу лотов перекрыт
-- новым: статус в нём первый.
DROP INDEX "listings_status_idx";

CREATE INDEX "listings_status_created_at_id_idx" ON "listings"("status", "created_at", "id");

CREATE INDEX "listings_created_at_id_idx" ON "listings"("created_at", "id");

CREATE INDEX "listings_title_trgm_idx" ON "listings" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "users_created_at_id_idx" ON "users"("created_at", "id");

CREATE INDEX "users_status_created_at_id_idx" ON "users"("status", "created_at", "id");

CREATE INDEX "users_email_trgm_idx" ON "users" USING GIN ("email" gin_trgm_ops);
