-- The itemised charges, frozen with the plan.
--
-- 🔴 `freeze_payment_plan` stored only the SUMS. The payment letter now prints
-- the arithmetic — "15 Amp : 4 × 1000 : ₹4,000.00" — because a vendor querying
-- their bill asks about the multiplication, not the total.
--
-- Recomputing those lines at render time would be wrong on every re-send. The
-- plan is deliberately frozen at the moment the letter goes out — it is what
-- the vendor was TOLD — and a vendor who revised their plug points afterwards
-- would get a reprint whose lines no longer add up to the total beside them.
-- A letter that visibly fails to sum is worse than one with no breakdown.
--
-- ⚠️ JSONB, not columns. The shape is `QuoteLine[]` and it is owned by
-- `quote.ts`; giving each item a column would mean a migration every time the
-- rate card grows a charge, and the lines are only ever read back whole.
ALTER TABLE "stalls"."stall_payment_plan"
  ADD COLUMN "lines" JSONB;

COMMENT ON COLUMN "stalls"."stall_payment_plan"."lines" IS
  'QuoteLine[] as frozen when the payment letter was sent. NULL on plans frozen before this column existed — the letter then falls back to the summed figures it has always printed.';
