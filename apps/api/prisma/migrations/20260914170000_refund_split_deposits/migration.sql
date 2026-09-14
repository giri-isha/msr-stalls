-- Each deduction is charged to its own deposit.
--
-- The requirement says which is which: furniture not returned or damaged comes
-- off the chairs-and-tables deposit, a fine for an unclean stall comes off the
-- stall deposit. Pooling them let an over-run on one quietly eat the other —
-- money the vendor is owed back — and reported no shortfall, so nobody chased
-- the excess either.
--
-- Existing rows are backfilled with the whole deposit on the stall bucket: that
-- is where a pooled figure behaved as if it sat, so no row changes meaning.
ALTER TABLE "stalls"."stall_refund"
  ADD COLUMN "stall_deposit_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "equipment_deposit_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stall_shortfall_paise" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "equipment_shortfall_paise" INTEGER NOT NULL DEFAULT 0;

UPDATE "stalls"."stall_refund"
   SET "stall_deposit_paise" = "deposit_held_paise",
       "stall_shortfall_paise" = "shortfall_paise";
