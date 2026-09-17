-- 🔴 The Log Call button becomes a FORM, and the questions on it are rows.
--
-- `stall_reminder_call` has been three facts since it was written — which
-- vendor, which kind, when — plus a `note` column no screen ever wrote to. So
-- the Communication list could say a vendor had been rung four times and not
-- one word about what came of it, which is the only thing the next caller needs
-- before ringing a fifth.
--
-- What is added: an outcome and a callback day on the call itself, and a form
-- per (edition, kind) whose questions an admin writes on the Call Log Form tab.
--
-- ⚠️ NOTHING IS BACK-FILLED. `outcome` is nullable and every existing call
-- keeps a null: those rows are a date and a person, and inventing an outcome
-- for a conversation nobody recorded would be worse than the gap. No
-- `stall_call_form` rows are written either — the reads seed them, exactly as
-- `ensureTemplates` does, because a migration that created them would have had
-- to invent a script.

-- CreateEnum
CREATE TYPE "stalls"."StallCallOutcome" AS ENUM ('NOT_ANSWERED', 'WRONG_NUMBER', 'CALLBACK', 'PROMISED', 'REFUSED', 'DONE');

-- AlterTable
ALTER TABLE "stalls"."stall_reminder_call" ADD COLUMN     "callback_date" DATE,
ADD COLUMN     "outcome" "stalls"."StallCallOutcome";

-- CreateTable
CREATE TABLE "stalls"."stall_call_form" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "kind" "stalls"."StallReminderKind" NOT NULL,
    "script" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ,
    "updated_by" TEXT,

    CONSTRAINT "stall_call_form_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_call_question" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "help" TEXT,
    "field_type" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "options" JSONB,
    "min" INTEGER,
    "max" INTEGER,
    "min_len" INTEGER,
    "max_len" INTEGER,
    "decimals" INTEGER,
    "pattern" TEXT,
    "pattern_hint" TEXT,
    "date_window" JSONB,
    "show_if_question_id" UUID,
    "show_if_value" TEXT,
    "show_on_outcomes" JSONB NOT NULL,

    CONSTRAINT "stall_call_question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_call_answer" (
    "id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "stall_call_answer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_call_form_edition_id_kind_key" ON "stalls"."stall_call_form"("edition_id", "kind");

-- CreateIndex
CREATE INDEX "stall_call_question_form_id_ordinal_idx" ON "stalls"."stall_call_question"("form_id", "ordinal");

-- CreateIndex
CREATE INDEX "stall_call_answer_question_id_idx" ON "stalls"."stall_call_answer"("question_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_call_answer_call_id_question_id_key" ON "stalls"."stall_call_answer"("call_id", "question_id");

-- AddForeignKey
ALTER TABLE "stalls"."stall_call_form" ADD CONSTRAINT "stall_call_form_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_call_question" ADD CONSTRAINT "stall_call_question_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "stalls"."stall_call_form"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_call_question" ADD CONSTRAINT "stall_call_question_show_if_question_id_fkey" FOREIGN KEY ("show_if_question_id") REFERENCES "stalls"."stall_call_question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_call_answer" ADD CONSTRAINT "stall_call_answer_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "stalls"."stall_reminder_call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_call_answer" ADD CONSTRAINT "stall_call_answer_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "stalls"."stall_call_question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ⚠️ A CHECK rather than application code, the same call `stall_payment_record`
-- makes about a withdrawal's reason. A day to ring back on, hanging off a call
-- that was refused or never answered, is a date that would show on the list as
-- a vendor to chase on Tuesday for a reason nobody can reconstruct.
ALTER TABLE "stalls"."stall_reminder_call"
  ADD CONSTRAINT "stall_reminder_call_callback_needs_outcome"
    CHECK ("callback_date" IS NULL OR "outcome" = 'CALLBACK');
