-- Поиск в «Заказах» по части номера, названия лота из заказа и ника другой
-- стороны — по индексу, а не перебором всех заказов продавца (на 50 тыс.
-- заказов перебор занимал 150–200 мс на каждый поиск).
-- Индексы — GIN по триграммам (pg_trgm) вместе со своей стороной сделки
-- (btree_gin): общий индекс на слово, частое у других продавцов, перебирал
-- бы их заказы. Оба расширения стандартные, с PostgreSQL 13 их может включить
-- владелец базы. По номеру и нику индексы описаны в schema.prisma, по
-- названию из снимка — только здесь: индекс по выражению Prisma не описывает
-- и в `prisma migrate diff` не трогает.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;

-- CreateIndex
CREATE INDEX "orders_seller_id_public_number_trgm_idx" ON "orders" USING gin ("seller_id", "public_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "orders_buyer_id_public_number_trgm_idx" ON "orders" USING gin ("buyer_id", "public_number" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "orders_seller_id_title_trgm_idx" ON "orders" USING gin ("seller_id", ("listing_snapshot" ->> 'title') gin_trgm_ops);

-- CreateIndex
CREATE INDEX "orders_buyer_id_title_trgm_idx" ON "orders" USING gin ("buyer_id", ("listing_snapshot" ->> 'title') gin_trgm_ops);

-- CreateIndex
CREATE INDEX "profiles_username_trgm_idx" ON "profiles" USING gin ("username" gin_trgm_ops);
