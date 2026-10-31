-- «Не могу войти» без доступа к почте аккаунта: новая почта для связи,
-- когда сотрудник попросил документы, сами документы (селфи с документом)
-- и когда их прислали. Привязать новую почту можно только аккаунту с
-- пройденной проверкой личности — документы сверяются с ней.

-- AlterTable
ALTER TABLE "account_recoveries" ADD COLUMN     "contact_email" TEXT,
ADD COLUMN     "evidence_at" TIMESTAMP(3),
ADD COLUMN     "evidence_refs" JSONB,
ADD COLUMN     "evidence_requested_at" TIMESTAMP(3);
