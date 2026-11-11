-- AlterTable
ALTER TABLE "personal_data_consents" ADD COLUMN     "erased_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "erased_at" TIMESTAMP(3);

