-- Причина отказа в проверке личности: продавец видит, что переснять.
-- AlterTable
ALTER TABLE "kyc_verifications" ADD COLUMN     "reason" TEXT;

