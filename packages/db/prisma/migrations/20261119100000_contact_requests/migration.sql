-- Обращения через форму /obrashchenie/ (юрдокументы, 19.11.2026).
-- CreateTable
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120),
    "contact" VARCHAR(200) NOT NULL,
    "text" TEXT NOT NULL,
    "ip_hash" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contact_requests_created_at_idx" ON "contact_requests"("created_at");
