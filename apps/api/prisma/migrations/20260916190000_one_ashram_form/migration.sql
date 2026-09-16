-- The two ashram forms become one.
--
-- 🔴 "Ashram Stall Request" and "Ashram Food Stall Request" asked the same
-- twenty-odd questions and differed by exactly one fact: whether the stall
-- sells food. That fact already has a column — `stall_request.stall_type` — and
-- that column is what the FSSAI step, the rate card's food column and the
-- planning grid have always read. Two REQUEST TYPES for it meant a department
-- declared it by picking a form before being asked a single question, and
-- picking wrong produced a request of the wrong type, with the wrong reference
-- prefix, recoverable only by submitting again.
--
-- So `ASHRAM_FOOD` leaves `StallRequestType` and `StallFormType`, and the one
-- ashram form asks `stallType` like the other two forms always have.
--
-- ⚠️ The `AFD-` references already handed out are NOT rewritten. They are
-- printed on challans and read down the phone; `RETIRED_PREFIX` in
-- `packages/stalls/src/reference.ts` is what still parses them, and
-- `stall_request.reference` is unique across prefixes so nothing collides.
--
-- ⚠️ `StallCategory.ASHRAM_FOOD` is a different enum and is untouched. That one
-- says who OCCUPIES a stall on the planning grid — the schema comment on
-- `StallType` spells the distinction out — and an ashram food stall is still
-- exactly that. Only the REQUEST type merges.

-- ── The requests themselves ─────────────────────────────────────────────────
--
-- ⚠️ `stall_type` first, and before the request type is rewritten. Every
-- `ASHRAM_FOOD` request was submitted with FOOD (the form set it from the type
-- rather than asking), so this changes nothing in practice — but it is the
-- column the fact lives in from now on, and running the merge without it would
-- be the one way to lose the fact entirely.
UPDATE "stalls"."stall_request"
   SET "stall_type" = 'FOOD'
 WHERE "request_type" = 'ASHRAM_FOOD' AND "stall_type" <> 'FOOD';

UPDATE "stalls"."stall_request"
   SET "request_type" = 'ASHRAM'
 WHERE "request_type" = 'ASHRAM_FOOD';

-- ── The reference counters ──────────────────────────────────────────────────
--
-- The surviving ASHRAM counter keeps counting. Dropping the AFD one skips no
-- reference and collides with none: `ASH-2026-0005` has never been issued
-- whatever the AFD counter had reached, because the prefix was different.
UPDATE "stalls"."stall_reference_sequence" s
   SET "request_type" = 'ASHRAM'
 WHERE s."request_type" = 'ASHRAM_FOOD'
   AND NOT EXISTS (
     SELECT 1 FROM "stalls"."stall_reference_sequence" a
      WHERE a."edition_id" = s."edition_id" AND a."request_type" = 'ASHRAM');

DELETE FROM "stalls"."stall_reference_sequence" WHERE "request_type" = 'ASHRAM_FOOD';

-- ── What a role may reach ───────────────────────────────────────────────────
--
-- A role scoped to "ashram food" is now scoped to ashram. `DISTINCT` because a
-- role scoped to both would otherwise end up naming ASHRAM twice, and
-- `unionRequestTypeScope` reads this array as a set.
UPDATE "stalls"."stall_role"
   SET "request_type_scope" = ARRAY(
         SELECT DISTINCT CASE WHEN t = 'ASHRAM_FOOD' THEN 'ASHRAM' ELSE t END
           FROM unnest("request_type_scope") AS t)
 WHERE 'ASHRAM_FOOD' = ANY("request_type_scope");

-- ── Appended questions survive the form they were appended to ───────────────
--
-- 🔴 BEFORE the definition is deleted, and this order is the whole point. An
-- admin's own question on the ashram food form has answers hanging off it in
-- `stall_custom_field_value`; the cascade below would take the question and
-- every answer with it. Re-pointed at the ashram form, they are kept — sitting
-- after its own questions, which is where an appended question lives anyway.
--
-- Their `section_id` is nulled by the cascade (ON DELETE SET NULL), so a
-- question that sat under a heading on the old form becomes a loose one on the
-- merged form. That is visible and fixable on the Form Builder; a deleted
-- answer is neither.
UPDATE "stalls"."stall_form_field" f
   SET "definition_id" = d."id",
       "form_type" = 'ASHRAM',
       "sort_order" = COALESCE(
         (SELECT MAX(o."sort_order") FROM "stalls"."stall_form_field" o
           WHERE o."definition_id" = d."id"), 0) + 1 + f."sort_order"
  FROM "stalls"."stall_form_definition" d
 WHERE f."form_type" = 'ASHRAM_FOOD'
   AND f."is_built_in" = FALSE
   AND d."edition_id" = f."edition_id"
   AND d."form_type" = 'ASHRAM';

-- The food form's own rows: its definition, its sections, and the built-in
-- fields that cascade with it. Nothing here holds an answer — a built-in's
-- answer is a column on `stall_request`, which the merge above already moved.
DELETE FROM "stalls"."stall_form_definition" WHERE "form_type" = 'ASHRAM_FOOD';
DELETE FROM "stalls"."stall_form_field" WHERE "form_type" = 'ASHRAM_FOOD';

-- ── The wording somebody ticked ─────────────────────────────────────────────
--
-- 🔴 Declarations are NEVER deleted here, and a consent goes on pointing at the
-- exact row that was on screen. The day a stall is in dispute, "what did they
-- agree to" has to be answerable, and these rows are the only place it is
-- written down.
--
-- An edition with no ashram wording of its own takes the food form's, unchanged
-- and still current.
UPDATE "stalls"."stall_declaration" d
   SET "form_type" = 'ASHRAM'
 WHERE d."form_type" = 'ASHRAM_FOOD'
   AND NOT EXISTS (
     SELECT 1 FROM "stalls"."stall_declaration" a
      WHERE a."edition_id" = d."edition_id" AND a."key" = d."key"
        AND a."form_type" = 'ASHRAM');

-- Everything else is a second wording for a form that now has one. The ashram
-- form's own wording stays current; the food form's is retyped and archived.
--
-- ⚠️ Its `version` is renumbered to sit above the ashram versions, and that is
-- the one thing this migration changes about a declaration. Versions are unique
-- within (edition, key, form_type) and both variants were seeded as version 1,
-- so one of the two ordinals has to move. The WORDING does not: title, body,
-- body_ta and created_at are untouched, which is what a consent actually
-- records. Keeping the ordinal would have meant deleting the row.
WITH renumbered AS (
  SELECT d."id",
         base.top + ROW_NUMBER() OVER (
           PARTITION BY d."edition_id", d."key" ORDER BY d."version", d."created_at", d."id")
           AS "version"
    FROM "stalls"."stall_declaration" d
    CROSS JOIN LATERAL (
      SELECT COALESCE(MAX(a."version"), 0) AS top
        FROM "stalls"."stall_declaration" a
       WHERE a."edition_id" = d."edition_id" AND a."key" = d."key"
         AND a."form_type" = 'ASHRAM'
    ) base
   WHERE d."form_type" = 'ASHRAM_FOOD'
)
UPDATE "stalls"."stall_declaration" d
   SET "form_type" = 'ASHRAM',
       "version" = r."version",
       "is_current" = FALSE,
       "archived_at" = COALESCE(d."archived_at", now())
  FROM renumbered r
 WHERE d."id" = r."id";

UPDATE "stalls"."stall_declaration_consent"
   SET "form_type" = 'ASHRAM'
 WHERE "form_type" = 'ASHRAM_FOOD';

-- ── The ashram form gains the question that replaced the second form ────────
--
-- 🔴 `seedFormDefinitions` is idempotent by DEFINITION: a form that already
-- exists is left entirely alone, so that re-running cannot resurrect a field an
-- admin deleted. That is the right rule and it means an edition already seeded
-- would never be given `stallType` — and without it the merged form cannot ask
-- the one thing it exists to ask, and every ashram submission would fail the
-- contract on a question that is not on screen.
--
-- So the two new questions are inserted here, once, for editions that already
-- have an ashram form. A new edition gets them from the constant.

-- Room for `stallType` directly under `stallName`, where a fact about the stall
-- belongs — above the questions whose answers depend on it.
UPDATE "stalls"."stall_form_field" f
   SET "sort_order" = f."sort_order" + 1
  FROM "stalls"."stall_form_definition" d
 WHERE f."definition_id" = d."id"
   AND d."form_type" = 'ASHRAM'
   AND f."sort_order" > (
     SELECT n."sort_order" FROM "stalls"."stall_form_field" n
      WHERE n."definition_id" = d."id" AND n."name" = 'stallName');

INSERT INTO "stalls"."stall_form_field"
  ("id", "edition_id", "definition_id", "form_type", "name", "label", "label_ta",
   "help", "field_type", "is_required", "is_built_in", "is_active", "sort_order", "options")
SELECT gen_random_uuid(), d."edition_id", d."id", 'ASHRAM', 'stallType', 'Type of stall', NULL,
       'A food stall must hold an FSSAI certificate before the event.',
       'select', TRUE, TRUE, TRUE,
       (SELECT n."sort_order" + 1 FROM "stalls"."stall_form_field" n
         WHERE n."definition_id" = d."id" AND n."name" = 'stallName'),
       '[{"value":"FOOD","label":"Food","labelTa":null},
         {"value":"NON_FOOD","label":"Non Food","labelTa":null}]'::jsonb
  FROM "stalls"."stall_form_definition" d
 WHERE d."form_type" = 'ASHRAM'
   AND EXISTS (SELECT 1 FROM "stalls"."stall_form_field" n
                WHERE n."definition_id" = d."id" AND n."name" = 'stallName')
   AND NOT EXISTS (SELECT 1 FROM "stalls"."stall_form_field" x
                    WHERE x."definition_id" = d."id" AND x."name" = 'stallType');

-- `fssaiExpected` was only ever on the food form. It goes on the end of the
-- merged one, asked only when `stallType` is FOOD — see `isFoodOnlyField`,
-- which the public page and the submit validator both read. A row rather than
-- an omission, so that an admin can reword it without a migration.
INSERT INTO "stalls"."stall_form_field"
  ("id", "edition_id", "definition_id", "form_type", "name", "label", "label_ta",
   "help", "field_type", "is_required", "is_built_in", "is_active", "sort_order", "options")
SELECT gen_random_uuid(), d."edition_id", d."id", 'ASHRAM', 'fssaiExpected',
       'Will you hold an FSSAI certificate for this stall?', NULL,
       'Food stalls must upload an FSSAI certificate before the event',
       'select', TRUE, TRUE, TRUE,
       COALESCE((SELECT MAX(o."sort_order") FROM "stalls"."stall_form_field" o
                  WHERE o."definition_id" = d."id"), 0) + 1,
       '[{"value":"YES","label":"Yes","labelTa":null},
         {"value":"NO","label":"No","labelTa":null}]'::jsonb
  FROM "stalls"."stall_form_definition" d
 WHERE d."form_type" = 'ASHRAM'
   AND NOT EXISTS (SELECT 1 FROM "stalls"."stall_form_field" x
                    WHERE x."definition_id" = d."id" AND x."name" = 'fssaiExpected');

-- ── The enums lose a value ──────────────────────────────────────────────────
--
-- ⚠️ Postgres cannot drop an enum value, so the type is rebuilt and every
-- column cast through text. The casts are safe only because nothing above still
-- holds 'ASHRAM_FOOD' — which is why the data comes first, in this same
-- transaction.
--
-- The partial unique indexes on `stall_declaration` and
-- `stall_declaration_consent` reference `form_type`; ALTER COLUMN TYPE rebuilds
-- them, so they survive without being named here.
ALTER TYPE "stalls"."StallRequestType" RENAME TO "StallRequestType_old";
CREATE TYPE "stalls"."StallRequestType" AS ENUM ('ASHRAM', 'LOCAL_WELFARE', 'VENDOR');

ALTER TABLE "stalls"."stall_request"
  ALTER COLUMN "request_type" TYPE "stalls"."StallRequestType"
  USING "request_type"::text::"stalls"."StallRequestType";

ALTER TABLE "stalls"."stall_reference_sequence"
  ALTER COLUMN "request_type" TYPE "stalls"."StallRequestType"
  USING "request_type"::text::"stalls"."StallRequestType";

DROP TYPE "stalls"."StallRequestType_old";

ALTER TYPE "stalls"."StallFormType" RENAME TO "StallFormType_old";
CREATE TYPE "stalls"."StallFormType"
  AS ENUM ('ASHRAM', 'LOCAL_WELFARE', 'VENDOR', 'BANK', 'FSSAI', 'STAFF');

ALTER TABLE "stalls"."stall_declaration"
  ALTER COLUMN "form_type" TYPE "stalls"."StallFormType"
  USING "form_type"::text::"stalls"."StallFormType";

ALTER TABLE "stalls"."stall_declaration_consent"
  ALTER COLUMN "form_type" TYPE "stalls"."StallFormType"
  USING "form_type"::text::"stalls"."StallFormType";

ALTER TABLE "stalls"."stall_form_definition"
  ALTER COLUMN "form_type" TYPE "stalls"."StallFormType"
  USING "form_type"::text::"stalls"."StallFormType";

ALTER TABLE "stalls"."stall_form_field"
  ALTER COLUMN "form_type" TYPE "stalls"."StallFormType"
  USING "form_type"::text::"stalls"."StallFormType";

DROP TYPE "stalls"."StallFormType_old";
