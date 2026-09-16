-- The bank, FSSAI and staff forms become rows like the four request forms.
--
-- 🔴 Their questions lived in JSX. Rewording a label, adding the Tamil beside
-- it, or ceasing to ask a question was a redeploy — the problem the Form
-- Builder exists to end, still live on the form that collects an account number
-- and the one that collects a government ID.

-- ── A question may be switched off, so its column may be empty ──────────────
--
-- 🔴 A built-in's column was NOT NULL because the JSX always asked for it. Now
-- that an admin can mark a question optional or stop asking it entirely, a
-- record can legitimately exist without that answer, and a NOT NULL would turn
-- an admin's configuration choice into a 500 at submit time.
--
-- ⚠️ Nullability is the FLOOR, not the policy. What a form actually insists on
-- is `is_required` on its field rows, enforced by `validateAgainstForm` in both
-- the browser and the API. Relaxing the column does not relax the form; it
-- stops the database contradicting it.
ALTER TABLE "stalls"."stall_bank_detail"
  ALTER COLUMN "email"          DROP NOT NULL,
  ALTER COLUMN "invoice_name"   DROP NOT NULL,
  ALTER COLUMN "account_holder" DROP NOT NULL,
  ALTER COLUMN "mobile"         DROP NOT NULL,
  ALTER COLUMN "address"        DROP NOT NULL,
  ALTER COLUMN "pincode"        DROP NOT NULL,
  ALTER COLUMN "bank_name"      DROP NOT NULL,
  ALTER COLUMN "branch"         DROP NOT NULL,
  ALTER COLUMN "account_number" DROP NOT NULL,
  ALTER COLUMN "ifsc"           DROP NOT NULL,
  ALTER COLUMN "pan_number"     DROP NOT NULL,
  ALTER COLUMN "gst_number"     DROP NOT NULL,
  ALTER COLUMN "cheque_key"     DROP NOT NULL,
  ALTER COLUMN "pan_key"        DROP NOT NULL;

ALTER TABLE "stalls"."stall_vendor_staff"
  ALTER COLUMN "name"      DROP NOT NULL,
  ALTER COLUMN "id_type"   DROP NOT NULL,
  ALTER COLUMN "id_number" DROP NOT NULL;

-- ⚠️ `stall_vendor_staff.mobile` is DELIBERATELY still NOT NULL, and it is the
-- one question on these three forms that cannot be switched off.
--
-- It is half of `stall_vendor_staff_request_id_mobile_key`, the unique index
-- behind "one person, one registration per stall". That index is what stops
-- somebody handed two coupon codes appearing twice and being counted twice at
-- the gate. A nullable mobile makes the index toothless — NULLs compare as
-- DISTINCT, so every registration without one would be a new person.
--
-- The Form Builder refuses to switch it off or make it optional for that
-- reason, and `LOCKED_REQUIRED` in `public-forms.ts` is where the screen and
-- the API both read it. This is structural, not a preference.

-- `request_id` and the timestamps stay NOT NULL everywhere: none of them is an
-- answer to a question, and a record belonging to no request is not a record.

-- ── A custom answer can belong to a person ─────────────────────────────────
--
-- 🔴 `stall_custom_field_value` was unique on (request_id, custom_field_id).
-- Eight staff register against one coupon and share a request, so an appended
-- question on the staff form would have seven of its eight answers collapse
-- into the first person's row — the same shape as the consent bug the
-- declarations work just fixed, and it takes the same answer.
ALTER TABLE "stalls"."stall_custom_field_value"
  ADD COLUMN "staff_id" UUID;

ALTER TABLE "stalls"."stall_custom_field_value"
  ADD CONSTRAINT "stall_custom_field_value_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "stalls"."stall_vendor_staff"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

DROP INDEX "stalls"."stall_custom_field_value_request_id_custom_field_id_key";

-- ⚠️ A PAIR, for the third time in this module. NULLs compare as DISTINCT in a
-- unique index, so a single index over (request_id, custom_field_id, staff_id)
-- would admit unlimited duplicate request-level answers.
CREATE UNIQUE INDEX "stall_custom_field_value_by_request"
  ON "stalls"."stall_custom_field_value" ("request_id", "custom_field_id")
  WHERE "staff_id" IS NULL;

CREATE UNIQUE INDEX "stall_custom_field_value_by_staff"
  ON "stalls"."stall_custom_field_value" ("staff_id", "custom_field_id")
  WHERE "staff_id" IS NOT NULL;

CREATE INDEX "stall_custom_field_value_staff_id_idx"
  ON "stalls"."stall_custom_field_value" ("staff_id");
