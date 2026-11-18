-- Сверка с ЮKassa, ошибки и тревоги (части 129–130).
-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "trigger" VARCHAR(8) NOT NULL,
    "window_from" TIMESTAMP(3) NOT NULL,
    "window_to" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(8) NOT NULL DEFAULT 'running',
    "checked" JSONB,
    "new_issues" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "started_by" UUID,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_issues" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "entity" VARCHAR(12) NOT NULL,
    "ref" VARCHAR(80) NOT NULL,
    "our_id" UUID,
    "external_id" TEXT,
    "ours" JSONB,
    "theirs" JSONB,
    "first_run_id" UUID NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "note" TEXT,

    CONSTRAINT "reconciliation_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_groups" (
    "id" UUID NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source" VARCHAR(8) NOT NULL,
    "message" TEXT NOT NULL,
    "context" TEXT,
    "stack" TEXT,
    "path" TEXT,
    "count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "error_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_events" (
    "id" UUID NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ops_alerts" (
    "id" UUID NOT NULL,
    "key" VARCHAR(40) NOT NULL,
    "text" TEXT NOT NULL,
    "sent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ops_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliation_runs_started_at_idx" ON "reconciliation_runs"("started_at");

-- CreateIndex
CREATE INDEX "reconciliation_issues_resolved_at_created_at_idx" ON "reconciliation_issues"("resolved_at", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reconciliation_issues_kind_ref_key" ON "reconciliation_issues"("kind", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "error_groups_fingerprint_key" ON "error_groups"("fingerprint");

-- CreateIndex
CREATE INDEX "error_groups_last_seen_at_idx" ON "error_groups"("last_seen_at");

-- CreateIndex
CREATE INDEX "ops_events_kind_at_idx" ON "ops_events"("kind", "at");

-- CreateIndex
CREATE INDEX "ops_alerts_key_created_at_idx" ON "ops_alerts"("key", "created_at");

-- CreateIndex
CREATE INDEX "ops_alerts_created_at_idx" ON "ops_alerts"("created_at");

