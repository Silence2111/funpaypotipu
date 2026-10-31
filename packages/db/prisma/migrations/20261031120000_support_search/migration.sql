-- Поиск в очереди поддержки — по части темы, ника автора и номера заказа.
-- Ник и номер ищутся по триграммам из orders_search_trgm, тема — по своим:
-- без них база перебирала все обращения (на 20 тыс. — 16 мс на поиск, с
-- соединением с профилями и заказами — 30). Индекс по заказу — чтобы
-- найденный заказ вёл к обращениям без перебора.
CREATE INDEX "support_tickets_subject_trgm_idx" ON "support_tickets" USING GIN ("subject" gin_trgm_ops);
CREATE INDEX "support_tickets_order_id_idx" ON "support_tickets"("order_id");
