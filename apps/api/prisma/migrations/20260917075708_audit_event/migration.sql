-- CreateEnum
CREATE TYPE "stalls"."StallAuditActorKind" AS ENUM ('BACKOFFICE', 'REQUESTER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "stalls"."StallAuditChannel" AS ENUM ('BACKOFFICE', 'PORTAL', 'SYSTEM');

-- CreateEnum
CREATE TYPE "stalls"."StallAuditOutcome" AS ENUM ('OK', 'FAILED');

-- CreateTable
CREATE TABLE "stalls"."stall_audit_event" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edition_id" UUID,
    "request_id" UUID,
    "account_id" UUID,
    "actor_kind" "stalls"."StallAuditActorKind" NOT NULL,
    "actor_ref" TEXT NOT NULL,
    "actor_name" TEXT NOT NULL,
    "on_behalf_of_account_id" UUID,
    "channel" "stalls"."StallAuditChannel" NOT NULL,
    "action" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "changes" JSONB,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "outcome" "stalls"."StallAuditOutcome" NOT NULL DEFAULT 'OK',

    CONSTRAINT "stall_audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stall_audit_event_edition_id_occurred_at_idx" ON "stalls"."stall_audit_event"("edition_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stall_audit_event_request_id_occurred_at_idx" ON "stalls"."stall_audit_event"("request_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stall_audit_event_actor_ref_occurred_at_idx" ON "stalls"."stall_audit_event"("actor_ref", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "stall_audit_event_action_idx" ON "stalls"."stall_audit_event"("action");

-- AddForeignKey
ALTER TABLE "stalls"."stall_audit_event" ADD CONSTRAINT "stall_audit_event_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_audit_event" ADD CONSTRAINT "stall_audit_event_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "stalls"."stall_account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
