-- 🔴 "Damaged" stops being a tick and becomes a COUNT, per chairs and tables,
-- the same shape the missing figures already have.
--
-- The counter is standing over a returned stack and knows that three of the
-- chairs are broken, not merely that something is. The flag could not say so,
-- and the refund is charged per item, so three broken chairs were priced as
-- one — the deduction the vendor argued about was wrong in the team's favour
-- only by accident.
ALTER TABLE "stalls"."stall_equipment_issue"
  ADD COLUMN "damaged_chairs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "damaged_tables" INTEGER NOT NULL DEFAULT 0;

-- ⚠️ A ticked row becomes exactly ONE damaged item, so every deduction already
-- recorded prices identically after this migration as before it: the old flat
-- penalty and one item at the per-item rate are the same figure. It lands on
-- chairs unless the stall never had a chair to break.
--
-- The true count is not recoverable — the flag never held one — so the counter
-- re-enters it on any row still open. The condition note usually says.
UPDATE "stalls"."stall_equipment_issue"
   SET "damaged_chairs" = CASE WHEN "chairs_requested" + "extra_chairs" > 0 THEN 1 ELSE 0 END,
       "damaged_tables" = CASE WHEN "chairs_requested" + "extra_chairs" > 0 THEN 0 ELSE 1 END
 WHERE "damaged" = true;

ALTER TABLE "stalls"."stall_equipment_issue" DROP COLUMN "damaged";
