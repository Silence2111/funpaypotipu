-- Отдельное согласие на обработку персональных данных (часть 120, 152-ФЗ ст. 9
-- с 01.09.2025): когда, какая версия текста, с какого адреса, как дано; отзыв.

-- CreateTable
CREATE TABLE "personal_data_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "method" VARCHAR(16) NOT NULL,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(300),
    "given_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "revoke_ip" VARCHAR(64),

    CONSTRAINT "personal_data_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_data_consents_user_id_given_at_idx" ON "personal_data_consents"("user_id", "given_at");

-- AddForeignKey
ALTER TABLE "personal_data_consents" ADD CONSTRAINT "personal_data_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

