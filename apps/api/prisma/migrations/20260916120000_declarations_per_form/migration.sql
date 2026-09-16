-- Declarations belong to a FORM, not to a request type.
--
-- 🔴 Only the four request forms could carry versioned wording. The bank form —
-- which collects an account number, an IFSC and a PAN, and asks a vendor to
-- accept terms and conditions — had its consent text typed into JSX and
-- recorded agreement as two bare timestamps, `agreed_neft_at` and
-- `agreed_terms_at`. That records THAT somebody agreed and never WHAT, which is
-- the exact failure this table was created to end.

-- ── The declaration's variant ───────────────────────────────────────────────
--
-- ⚠️ Every existing value maps to ITSELF: the four request-type names are
-- already form-type names, so this is a widening and no row moves. The USING
-- clause goes via TEXT because Postgres will not cast between two unrelated
-- enums directly.
ALTER TABLE "stalls"."stall_declaration"
  ALTER COLUMN "request_type" TYPE "stalls"."StallFormType"
  USING "request_type"::TEXT::"stalls"."StallFormType";

ALTER TABLE "stalls"."stall_declaration"
  RENAME COLUMN "request_type" TO "form_type";

-- The four partial indexes are rebuilt rather than altered: two of them carry
-- `WHERE request_type IS NULL` in their predicate, which a column rename does
-- not follow. Their PAIRING is load-bearing — NULLs compare as DISTINCT in a
-- unique index, so the second of each pair covers exactly the rows the first
-- cannot see, and dropping either would admit two current defaults.
DROP INDEX "stalls"."stall_declaration_one_current";
DROP INDEX "stalls"."stall_declaration_one_current_default";
DROP INDEX "stalls"."stall_declaration_version";
DROP INDEX "stalls"."stall_declaration_version_default";

CREATE UNIQUE INDEX "stall_declaration_one_current"
  ON "stalls"."stall_declaration" ("edition_id", "key", "form_type")
  WHERE "is_current";

CREATE UNIQUE INDEX "stall_declaration_one_current_default"
  ON "stalls"."stall_declaration" ("edition_id", "key")
  WHERE "is_current" AND "form_type" IS NULL;

CREATE UNIQUE INDEX "stall_declaration_version"
  ON "stalls"."stall_declaration" ("edition_id", "key", "form_type", "version");

CREATE UNIQUE INDEX "stall_declaration_version_default"
  ON "stalls"."stall_declaration" ("edition_id", "key", "version")
  WHERE "form_type" IS NULL;

-- ── A consent says which form it was given on, and by whom ──────────────────
--
-- 🔴 The old unique index was (request_id, declaration_id). One row per request
-- per declaration was right while only one form could show one. It breaks twice
-- the moment others can:
--
--   (1) The same key can be ticked on the request form and again on the bank
--       form, months apart, against wording that may have been re-versioned in
--       between. `recordConsent` passes `skipDuplicates`, so the second consent
--       would be discarded SILENTLY — the vendor saw a tick and the log has
--       nothing. A consent that is not recorded is worse than one never asked
--       for, because the page told them it was.
--
--   (2) Eight staff register against one coupon and share one request_id. Seven
--       of their consents would collapse into the first person's row, and the
--       log would say one person had agreed on behalf of a team.
ALTER TABLE "stalls"."stall_declaration_consent"
  ADD COLUMN "form_type" "stalls"."StallFormType",
  ADD COLUMN "staff_id"  UUID;

-- Every consent written so far came from a request form, so the backfill is
-- unambiguous: the request's own type, and nobody's staff id.
UPDATE "stalls"."stall_declaration_consent" c
   SET "form_type" = r."request_type"::TEXT::"stalls"."StallFormType"
  FROM "stalls"."stall_request" r
 WHERE r."id" = c."request_id";

ALTER TABLE "stalls"."stall_declaration_consent"
  ALTER COLUMN "form_type" SET NOT NULL;

-- ⚠️ CASCADE. A staff member removed from the roster takes their own consent
-- with them — it was theirs, it referred to their registration, and leaving it
-- behind would be a consent attached to nobody. The requester's own consents
-- are untouched by this: their `staff_id` is NULL.
-- ⚠️ `ON UPDATE CASCADE` matches the two foreign keys already on this table.
-- It is Prisma's default for a relation, so omitting it reads as a deliberate
-- choice to the drift check and it reports the constraint as changed on every
-- run.
ALTER TABLE "stalls"."stall_declaration_consent"
  ADD CONSTRAINT "stall_declaration_consent_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "stalls"."stall_vendor_staff"("id")
    ON UPDATE CASCADE ON DELETE CASCADE;

DROP INDEX "stalls"."stall_declaration_consent_request_id_declaration_id_key";

-- ⚠️ A PAIR again, for the same Postgres reason as the declaration table above:
-- a single index over (request_id, form_type, staff_id, declaration_id) would
-- admit unlimited duplicate rows for the requester's own consents, because
-- staff_id is NULL on every one of them and NULLs compare as DISTINCT.
CREATE UNIQUE INDEX "stall_declaration_consent_by_form"
  ON "stalls"."stall_declaration_consent" ("request_id", "form_type", "declaration_id")
  WHERE "staff_id" IS NULL;

CREATE UNIQUE INDEX "stall_declaration_consent_by_staff"
  ON "stalls"."stall_declaration_consent" ("staff_id", "declaration_id")
  WHERE "staff_id" IS NOT NULL;

CREATE INDEX "stall_declaration_consent_staff_id_idx"
  ON "stalls"."stall_declaration_consent" ("staff_id");

CREATE INDEX "stall_declaration_consent_request_id_form_type_idx"
  ON "stalls"."stall_declaration_consent" ("request_id", "form_type");

-- ── The "I Agree" field retires ─────────────────────────────────────────────
--
-- Its wording is a row now, and its tick is drawn beside that wording directly
-- above Submit. Switched OFF rather than deleted: a form that has been answered
-- still names what it asked, which is why `canDeleteField` refuses built-ins at
-- all. The seed stops emitting it for new editions separately.
UPDATE "stalls"."stall_form_field" SET "is_active" = false WHERE "name" = 'agreed';
