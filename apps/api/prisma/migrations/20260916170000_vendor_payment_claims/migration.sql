-- A vendor says what they transferred; finance verifies it.
--
-- 🔴 `stall_payment_record` is finance-entered ONLY — `confirmed_by` is NOT
-- NULL and `confirmed_at` defaults to now, so every row in it IS a
-- confirmation. There was no shape for an unverified claim, and the 2025 letter
-- filled the gap with "please send transfer details on E-mail IDs
-- finance.support@… once you make the payment": a mailbox, matched by hand.
--
-- ⚠️ A SEPARATE TABLE, not a nullable `confirmed_by` on the record. The failure
-- mode of the latter is money counted as received when it has not been — every
-- query that reads a payment as settled would need a
-- `WHERE confirmed_by IS NOT NULL`, and the one that forgot would do it
-- silently. Nothing that reads `stall_payment_record` changes meaning here.

CREATE TYPE "stalls"."StallPaymentClaimStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

CREATE TABLE "stalls"."stall_payment_claim" (
  -- ⚠️ No DB default: Prisma generates the uuid client-side for this model,
  -- and a server-side default here reads as drift on every check.
  "id"         UUID                               NOT NULL,
  "request_id" UUID                               NOT NULL,
  "purpose"    "stalls"."StallPaymentPurpose"     NOT NULL,
  "status"     "stalls"."StallPaymentClaimStatus" NOT NULL DEFAULT 'PENDING',

  -- What the vendor typed off their bank statement.
  "reference_no"  TEXT        NOT NULL,
  "amount_paise"  INTEGER     NOT NULL,
  -- A banking DATE, not an instant — the day the transfer shows on the
  -- statement, which is what finance matches against.
  "paid_on"       DATE        NOT NULL,
  "remitter_name" TEXT,
  -- A media-store key. Optional: a vendor who transferred at a branch counter
  -- may have only a stamped slip they cannot photograph well, and refusing the
  -- claim over that would send them back to email.
  "receipt_key"   TEXT,
  "note"          TEXT,

  "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Who settled it, and when. Both null while PENDING.
  "reviewed_at" TIMESTAMPTZ,
  "reviewed_by" TEXT,
  -- ⚠️ Required on REJECTED — enforced by the CHECK below, not by application
  -- code. A rejection with no reason is one the vendor cannot act on, and they
  -- are told this text.
  "reject_reason" TEXT,

  -- The confirmed receipt this claim became. Set on VERIFIED, so the claim and
  -- the money it accounts for can be read from either end.
  "payment_record_id" UUID,

  CONSTRAINT "stall_payment_claim_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stall_payment_claim_request_id_fkey"
    FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id")
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT "stall_payment_claim_payment_record_id_fkey"
    FOREIGN KEY ("payment_record_id") REFERENCES "stalls"."stall_payment_record"("id")
    ON UPDATE CASCADE ON DELETE SET NULL,

  CONSTRAINT "stall_payment_claim_reject_reason"
    CHECK ("status" <> 'REJECTED' OR ("reject_reason" IS NOT NULL AND "reject_reason" <> '')),
  CONSTRAINT "stall_payment_claim_amount_positive" CHECK ("amount_paise" > 0)
);

-- 🔴 One reference number is one credit, per request — the same rule
-- `stall_payment_record` enforces, applied a step earlier so a vendor who
-- submits the same UTR twice (a refreshed form, an impatient second attempt)
-- does not create two claims finance has to reconcile against one transfer.
--
-- ⚠️ Scoped to the LIVE claims. A rejected claim keeps its reference so the
-- vendor can be shown what was wrong with it, and they must still be able to
-- resubmit a corrected claim carrying the same UTR — which is the common case
-- when the mistake was the amount or the date.
CREATE UNIQUE INDEX "stall_payment_claim_live_reference"
  ON "stalls"."stall_payment_claim" ("request_id", "reference_no")
  WHERE "status" <> 'REJECTED';

CREATE INDEX "stall_payment_claim_request_id_idx"
  ON "stalls"."stall_payment_claim" ("request_id");

-- The finance queue reads this: everything still waiting, oldest first.
CREATE INDEX "stall_payment_claim_status_submitted_at_idx"
  ON "stalls"."stall_payment_claim" ("status", "submitted_at");
