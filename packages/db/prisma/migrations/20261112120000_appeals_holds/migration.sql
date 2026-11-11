-- Блокировки без «чёрного ящика» (часть 134): пункт правил у решения,
-- обжалования другому сотруднику, удержание только спорной суммы (счёт
-- held), эскалация затянувшейся проверки вывода.
-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('open', 'upheld', 'overturned');

-- AlterEnum
ALTER TYPE "LedgerAccountKind" ADD VALUE 'held';

-- AlterEnum


ALTER TYPE "ModerationActionType" ADD VALUE 'mute';
ALTER TYPE "ModerationActionType" ADD VALUE 'hold';

-- AlterTable
ALTER TABLE "moderation_actions" ADD COLUMN     "rule" TEXT;

-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "escalated_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "appeals" (
    "id" UUID NOT NULL,
    "action_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'open',
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "note" TEXT,
    "due_at" TIMESTAMP(3) NOT NULL,
    "escalated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_holds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "rule" TEXT,
    "created_by" UUID NOT NULL,
    "released_at" TIMESTAMP(3),
    "released_by" UUID,
    "release_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appeals_action_id_key" ON "appeals"("action_id");

-- CreateIndex
CREATE INDEX "appeals_status_created_at_idx" ON "appeals"("status", "created_at");

-- CreateIndex
CREATE INDEX "appeals_user_id_idx" ON "appeals"("user_id");

-- CreateIndex
CREATE INDEX "balance_holds_user_id_released_at_idx" ON "balance_holds"("user_id", "released_at");

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "moderation_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_holds" ADD CONSTRAINT "balance_holds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
