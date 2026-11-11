-- AlterTable
ALTER TABLE "users" ADD COLUMN     "phone_verified_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "phone_codes" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "purpose" VARCHAR(8) NOT NULL,
    "user_id" UUID,
    "code_hash" VARCHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "phone_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "phone_codes_phone_created_at_idx" ON "phone_codes"("phone", "created_at");

