-- Лента подписок: когда человек последний раз её открывал.

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "follow_feed_seen_at" TIMESTAMP(3);

