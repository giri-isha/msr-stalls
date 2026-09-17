-- The steps open in an order the edition chooses.
--
-- `stall_flow_config` says WHETHER a step happens. Nothing said WHEN. A stall
-- team that wants "no coupon until the money is in" had no way to express it,
-- and a selected vendor was handed all four steps at once.

-- ── The vocabulary ─────────────────────────────────────────────────────────
--
-- ⚠️ An enum rather than a text column. The table gates on this value, so a
-- typo would be a row that silently sequences nothing.
CREATE TYPE "stalls"."StallOnboardingStep" AS ENUM (
  'BANK_FORM',
  'PAYMENT',
  'FSSAI',
  'STAFF_REGISTRATION'
);

-- ── The ordering ───────────────────────────────────────────────────────────
--
-- One row per (edition, requester type, step). The LOWEST stage still
-- outstanding is the one the requester may act on; everything above it is
-- locked until that stage clears.
--
-- 🔴 `stage` defaults to 1, and a MISSING row reads as 1 in the application
-- too. All-ones is today's behaviour — nothing is ever locked — so this table
-- may be sparse and no existing edition changes when it lands.
CREATE TABLE "stalls"."stall_flow_step" (
  "id"           UUID NOT NULL DEFAULT gen_random_uuid(),
  "edition_id"   UUID NOT NULL,
  "request_type" "stalls"."StallRequestType" NOT NULL,
  "step"         "stalls"."StallOnboardingStep" NOT NULL,
  "stage"        INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "stall_flow_step_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stall_flow_step_edition_id_request_type_step_key"
  ON "stalls"."stall_flow_step" ("edition_id", "request_type", "step");

ALTER TABLE "stalls"."stall_flow_step"
  ADD CONSTRAINT "stall_flow_step_edition_id_fkey"
  FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing edition gets the full twelve at stage 1, so the Admin grid
-- opens on real rows rather than on inferred ones. The application still reads
-- a missing row as 1; this is so the screen has something to edit.
INSERT INTO "stalls"."stall_flow_step" ("edition_id", "request_type", "step", "stage")
SELECT e."id", t."request_type", s."step", 1
FROM "stalls"."stall_edition" e
CROSS JOIN (
  VALUES ('VENDOR'::"stalls"."StallRequestType"),
         ('LOCAL_WELFARE'),
         ('ASHRAM')
) AS t("request_type")
CROSS JOIN (
  VALUES ('BANK_FORM'::"stalls"."StallOnboardingStep"),
         ('PAYMENT'),
         ('FSSAI'),
         ('STAFF_REGISTRATION')
) AS s("step")
ON CONFLICT DO NOTHING;

-- ── The local welfare form is missing a question ───────────────────────────
--
-- The 2025 local welfare sheet asks "Number of Stall Staff Pass". The seed had
-- `passes2w` and `passes4w` and stopped; the vendor (by way of the bank form)
-- and ashram forms both ask it, and `passes_staff` has always been a real
-- column on `stall_request`.
--
-- ⚠️ The seed constant reaches no existing edition — `seedFormDefinitions`
-- skips a definition that already exists, which is the point of forms being
-- rows. So the question is inserted here for editions that already exist, in
-- the position it would have been seeded into, the way `declarations_per_form`
-- edited editions that already existed.
--
-- Everything sitting after `passes4w` shifts down by one first, so an appended
-- question an admin added keeps its place relative to the built-ins.
WITH anchor AS (
  SELECT f."definition_id", f."edition_id", f."sort_order"
  FROM "stalls"."stall_form_field" f
  WHERE f."form_type" = 'LOCAL_WELFARE'
    AND f."name" = 'passes4w'
    AND f."definition_id" IS NOT NULL
    -- Only where the question is genuinely absent; re-running must not add a
    -- second one.
    AND NOT EXISTS (
      SELECT 1 FROM "stalls"."stall_form_field" g
      WHERE g."definition_id" = f."definition_id" AND g."name" = 'passesStaff'
    )
)
UPDATE "stalls"."stall_form_field" f
SET "sort_order" = f."sort_order" + 1
FROM anchor a
WHERE f."definition_id" = a."definition_id"
  AND f."sort_order" > a."sort_order";

INSERT INTO "stalls"."stall_form_field" (
  "id", "edition_id", "definition_id", "name", "form_type",
  "label", "label_ta", "field_type", "is_required", "sort_order",
  "is_active", "is_built_in", "min", "max"
)
SELECT
  gen_random_uuid(), f."edition_id", f."definition_id", 'passesStaff', 'LOCAL_WELFARE',
  'Number of Stall Staff Pass', NULL, 'number', TRUE, f."sort_order" + 1,
  TRUE, TRUE, 0, 200
FROM "stalls"."stall_form_field" f
WHERE f."form_type" = 'LOCAL_WELFARE'
  AND f."name" = 'passes4w'
  AND f."definition_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "stalls"."stall_form_field" g
    WHERE g."definition_id" = f."definition_id" AND g."name" = 'passesStaff'
  );
