-- What the furniture deduction was MADE OF, frozen onto the refund.
--
-- 🔴 Frozen rather than recomputed, the same rule `stall_payment_plan.lines`
-- follows. The counter's figures can be corrected after a refund has been sent,
-- and a breakdown read off today's counts would stop adding up to the frozen
-- total printed beside it — which is the one number the vendor was told.
--
-- Nullable, and null is meaningful: refunds sent before this column existed have
-- no breakdown to show, and the screen falls back to the single figure it has
-- always shown rather than inventing one.
ALTER TABLE "stalls"."stall_refund"
  ADD COLUMN "equipment_lines" JSONB;
