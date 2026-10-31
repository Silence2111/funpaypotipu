-- Список диалогов в мессенджере — свежие сверху по времени последнего
-- сообщения (у пустого диалога — создания) и «Показать ещё» от последнего
-- показанного. С индексом по одной стороне база на каждую страницу читала
-- все диалоги продавца вразнобой и сортировала: на 20 тыс. диалогов — 14 мс
-- в общем плане подготовленного запроса. Здесь индекс в порядке самого
-- списка, и страница — первые его строки.
--
-- Индекс по выражению Prisma не описывает — он только здесь. Прежние
-- индексы по одной стороне он заменяет: поиск по ней идёт по его началу.
CREATE INDEX "conversations_seller_id_activity_idx" ON "conversations" ("seller_id", (COALESCE("last_message_at", "created_at")) DESC, "id" DESC);
CREATE INDEX "conversations_buyer_id_activity_idx" ON "conversations" ("buyer_id", (COALESCE("last_message_at", "created_at")) DESC, "id" DESC);
DROP INDEX "conversations_seller_id_idx";
DROP INDEX "conversations_buyer_id_idx";
