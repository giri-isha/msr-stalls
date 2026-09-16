-- A form may say something, not only ask.
--
-- 🔴 Every row in `stall_form_field` has been a QUESTION. The venue layout, the
-- note about what counts as a food stall, the line about what the deposit
-- covers — all of it lived in JSX above the form or in nothing at all, so
-- putting a picture beside the location question was a redeploy, which is the
-- problem the Form Builder exists to end.
--
-- A display block is the same row with `field_type = 'display'`: it has a
-- label (its heading, and the picture's description for a screen reader),
-- help (its wording), an optional picture, and no answer. `is_required` is
-- forced false for one — a required question with no control to answer it is a
-- form that fails validation with nothing to click — and `validateAgainstForm`
-- skips it whatever the column says.
--
-- ⚠️ No enum. `field_type` is text and always has been, so a new kind of field
-- is a value rather than a migration on a type; what makes `display` real is
-- `AUTHORABLE_FIELD_TYPES` in `packages/stalls`, which the API refuses writes
-- against and the builder draws its picker from.

ALTER TABLE "stalls"."stall_form_field"
  ADD COLUMN "media_key" TEXT;
