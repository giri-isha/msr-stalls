-- 🔴 A credit entered in error is WITHDRAWN, never deleted.
--
-- Deleting the row left the audit log as the only trace, which nobody on the
-- finance screen can read: the vendor who rings to ask why their payment
-- "disappeared" is owed an answer, and "recorded on the 14th, withdrawn on the
-- 16th — wrong reference" is a different fact from "never seen".
ALTER TABLE "stalls"."stall_payment_record"
  ADD COLUMN "voided_at"   TIMESTAMPTZ,
  ADD COLUMN "voided_by"   TEXT,
  ADD COLUMN "void_reason" TEXT;

-- ⚠️ A CHECK rather than application code. An entry withdrawn with no reason is
-- one nobody can reconcile against the statement six months on.
ALTER TABLE "stalls"."stall_payment_record"
  ADD CONSTRAINT "stall_payment_record_void_reason"
    CHECK (
      "voided_at" IS NULL
      OR ("void_reason" IS NOT NULL AND "void_reason" <> '')
    );

-- 🔴 The reference uniqueness narrows to the LIVE records, the same shape
-- `stall_payment_claim_live_reference` already uses a step earlier in the flow.
--
-- ⚠️ Without this, withdrawing an entry would bar its own correction: the
-- mistake is nearly always the amount, the date or the purpose rather than the
-- transfer, so the fixed row carries the SAME UTR and the old blanket unique
-- index would refuse it — leaving delete as the only way out, which is what
-- this migration exists to remove.
DROP INDEX "stalls"."stall_payment_record_request_id_reference_no_key";

CREATE UNIQUE INDEX "stall_payment_record_live_reference"
  ON "stalls"."stall_payment_record" ("request_id", "reference_no")
  WHERE "voided_at" IS NULL;
