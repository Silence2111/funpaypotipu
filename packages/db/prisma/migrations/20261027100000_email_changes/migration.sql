-- Смена почты из «Безопасности»: просьба (подтверждается ссылкой на новую
-- почту), итог и «Это не я» со старой почты — вернуть её в течение 7 дней.

-- CreateTable
CREATE TABLE "email_changes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "old_email" TEXT,
    "new_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "device" TEXT,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "reverted_at" TIMESTAMP(3),

    CONSTRAINT "email_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_changes_user_id_status_idx" ON "email_changes"("user_id", "status");

-- CreateIndex
CREATE INDEX "email_changes_old_email_status_idx" ON "email_changes"("old_email", "status");

-- AddForeignKey
ALTER TABLE "email_changes" ADD CONSTRAINT "email_changes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

