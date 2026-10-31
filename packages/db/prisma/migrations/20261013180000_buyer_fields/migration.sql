-- Данные, которые продавец спрашивает у покупателя при покупке (ник, сервер).
ALTER TABLE "listings" ADD COLUMN "buyer_fields" JSONB;
