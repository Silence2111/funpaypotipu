-- Сроки хранения и акт об уничтожении (часть 147).
-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "scrubbed_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "erasure_events" (
    "id" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(40) NOT NULL,
    "subject" TEXT NOT NULL,
    "user_id" UUID,
    "categories" TEXT[],
    "count" INTEGER NOT NULL DEFAULT 1,
    "act_id" UUID,

    CONSTRAINT "erasure_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erasure_acts" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "day" DATE NOT NULL,
    "reason" VARCHAR(40) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signed_by" UUID,
    "signed_at" TIMESTAMP(3),

    CONSTRAINT "erasure_acts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "erasure_events_act_id_idx" ON "erasure_events"("act_id");

-- CreateIndex
CREATE INDEX "erasure_events_at_idx" ON "erasure_events"("at");

-- CreateIndex
CREATE UNIQUE INDEX "erasure_acts_number_key" ON "erasure_acts"("number");

-- CreateIndex
CREATE UNIQUE INDEX "erasure_acts_day_reason_key" ON "erasure_acts"("day", "reason");

-- AddForeignKey
ALTER TABLE "erasure_events" ADD CONSTRAINT "erasure_events_act_id_fkey" FOREIGN KEY ("act_id") REFERENCES "erasure_acts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

