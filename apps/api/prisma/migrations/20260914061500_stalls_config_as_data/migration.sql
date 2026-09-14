-- Configuration that the stalls team changes every season stops being code.
--
-- Zones, planning categories, rents and advances were all modelled as fixed
-- sets. The venue layout is redrawn each year, the planning sheet's columns are
-- a judgement made each season, and rent differs bay by bay rather than by
-- bands of bays — so each of those becomes per-edition data an admin edits.
--
-- Everything here preserves what is already stored. Nothing is dropped until
-- the value it held has been carried across.

-- ── New vocabularies ────────────────────────────────────────────────────────

CREATE TYPE "stalls"."StallRateScope" AS ENUM ('VENDOR', 'LOCAL_WELFARE');
CREATE TYPE "stalls"."StallMessageChannel" AS ENUM ('EMAIL', 'WHATSAPP');
CREATE TYPE "stalls"."StallSignatureStatus" AS ENUM (
  'NOT_SENT', 'SENT', 'SIGNED', 'DECLINED', 'EXPIRED', 'FAILED'
);

-- ── Edition: the season's own settings ──────────────────────────────────────

ALTER TABLE "stalls"."stall_edition"
  ADD COLUMN "virtual_account_rent_prefix"    TEXT,
  ADD COLUMN "virtual_account_deposit_prefix" TEXT,
  ADD COLUMN "max_stalls_per_request"         INTEGER NOT NULL DEFAULT 2;

-- ── Planning categories become rows ─────────────────────────────────────────

CREATE TABLE "stalls"."stall_plan_category" (
  "id"         UUID    NOT NULL,
  "edition_id" UUID    NOT NULL,
  "key"        TEXT    NOT NULL,
  "name"       TEXT    NOT NULL,
  "is_food"    BOOLEAN NOT NULL,
  "sort_order" INTEGER NOT NULL,
  CONSTRAINT "stall_plan_category_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stall_plan_category_edition_id_key_key"
  ON "stalls"."stall_plan_category"("edition_id", "key");
ALTER TABLE "stalls"."stall_plan_category"
  ADD CONSTRAINT "stall_plan_category_edition_id_fkey"
  FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE;

-- Every edition gets the full set: the seven columns that already existed, plus
-- the sponsor and Adiyogi columns the 2025 planning sheet carried but the enum
-- never had, so a sponsor stall could not be counted apart from an ashram one.
INSERT INTO "stalls"."stall_plan_category" ("id", "edition_id", "key", "name", "is_food", "sort_order")
SELECT gen_random_uuid(), e."id", c."key", c."name", c."is_food", c."sort_order"
FROM "stalls"."stall_edition" e
CROSS JOIN (VALUES
  ('VENDOR_FOOD',      'Vendor food',             TRUE,  0),
  ('ASHRAM_FOOD',      'Ashram food',             TRUE,  1),
  ('ADIYOGI_FOOD',     'Adiyogi food',            TRUE,  2),
  ('SPONSOR_FOOD',     'Sponsor food',            TRUE,  3),
  ('LW_FOOD',          'Local welfare food',      TRUE,  4),
  ('VENDOR_NON_FOOD',  'Vendor non-food',         FALSE, 5),
  ('ASHRAM_NON_FOOD',  'Ashram non-food',         FALSE, 6),
  ('SPONSOR_NON_FOOD', 'Sponsor non-food',        FALSE, 7),
  ('LW_NON_FOOD',      'Local welfare non-food',  FALSE, 8),
  ('HELP_DESK',        'Help desk',               FALSE, 9),
  ('BACKUP',           'Backup',                  FALSE, 10)
) AS c("key", "name", "is_food", "sort_order");

-- Plans repoint at the row that carries the key they already held.
ALTER TABLE "stalls"."stall_zone_plan" ADD COLUMN "category_id" UUID;
UPDATE "stalls"."stall_zone_plan" p
SET "category_id" = c."id"
FROM "stalls"."stall_zone" z, "stalls"."stall_plan_category" c
WHERE p."zone_id" = z."id"
  AND c."edition_id" = z."edition_id"
  AND c."key" = p."category"::TEXT;

DELETE FROM "stalls"."stall_zone_plan" WHERE "category_id" IS NULL;
ALTER TABLE "stalls"."stall_zone_plan" ALTER COLUMN "category_id" SET NOT NULL;
DROP INDEX IF EXISTS "stalls"."stall_zone_plan_zone_id_category_key";
ALTER TABLE "stalls"."stall_zone_plan" DROP COLUMN "category";
CREATE UNIQUE INDEX "stall_zone_plan_zone_id_category_id_key"
  ON "stalls"."stall_zone_plan"("zone_id", "category_id");
ALTER TABLE "stalls"."stall_zone_plan"
  ADD CONSTRAINT "stall_zone_plan_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "stalls"."stall_plan_category"("id") ON DELETE CASCADE;

-- Stalls likewise.
ALTER TABLE "stalls"."stall" ADD COLUMN "category_id" UUID;
UPDATE "stalls"."stall" s
SET "category_id" = c."id"
FROM "stalls"."stall_zone" z, "stalls"."stall_plan_category" c
WHERE s."zone_id" = z."id"
  AND c."edition_id" = z."edition_id"
  AND c."key" = s."category"::TEXT;

DELETE FROM "stalls"."stall" WHERE "category_id" IS NULL;
ALTER TABLE "stalls"."stall" ALTER COLUMN "category_id" SET NOT NULL;
ALTER TABLE "stalls"."stall" DROP COLUMN "category";
ALTER TABLE "stalls"."stall"
  ADD CONSTRAINT "stall_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "stalls"."stall_plan_category"("id");

DROP TYPE "stalls"."StallCategory";

-- ── Rents become per bay, per requester scope, carrying their own advance ───

ALTER TABLE "stalls"."stall_rate_card"
  ADD COLUMN "zone_code"     TEXT,
  ADD COLUMN "scope"         "stalls"."StallRateScope",
  ADD COLUMN "deposit_paise" INTEGER;

-- The banded rows stay readable while the expanded ones are written from them,
-- so the old column has to tolerate the new rows not having one.
ALTER TABLE "stalls"."stall_rate_card" ALTER COLUMN "zone_group" DROP NOT NULL;

-- The old rows were banded. Expand each band across the bays it covered, using
-- the same grouping the code used: A3 and B2 closed, anything starting with C
-- in the C band, everything else in AB.
CREATE TEMP TABLE _band AS
SELECT z."edition_id",
       z."code" AS zone_code,
       CASE
         WHEN z."code" IN ('A3', 'B2') THEN 'CLOSED'
         WHEN z."code" LIKE 'C%'       THEN 'C'
         ELSE                               'AB'
       END AS band
FROM "stalls"."stall_zone" z;

INSERT INTO "stalls"."stall_rate_card"
  ("id", "edition_id", "zone_code", "is_food", "scope", "amount_paise", "deposit_paise")
SELECT gen_random_uuid(), b."edition_id", b.zone_code, r."is_food", 'VENDOR',
       r."amount_paise", cc."vendor_deposit_paise"
FROM _band b
JOIN "stalls"."stall_rate_card" r
  ON r."edition_id" = b."edition_id" AND r."zone_group"::TEXT = b.band
JOIN "stalls"."stall_charge_config" cc ON cc."edition_id" = b."edition_id"
WHERE b.band <> 'CLOSED';

-- Local welfare was quoted off the vendor card, which is why a bay closed to
-- trade could not be priced at all — including the bays where the local welfare
-- stalls that pay the most actually stand. Every bay now carries a local
-- welfare row: the open bays at what they were already charging, the two closed
-- bays at the adjacent AB band, for the team to set against their own figures.
INSERT INTO "stalls"."stall_rate_card"
  ("id", "edition_id", "zone_code", "is_food", "scope", "amount_paise", "deposit_paise")
SELECT gen_random_uuid(), b."edition_id", b.zone_code, r."is_food", 'LOCAL_WELFARE',
       r."amount_paise", cc."local_welfare_deposit_paise"
FROM _band b
JOIN "stalls"."stall_rate_card" r
  ON r."edition_id" = b."edition_id"
 AND r."zone_group"::TEXT = CASE WHEN b.band = 'CLOSED' THEN 'AB' ELSE b.band END
JOIN "stalls"."stall_charge_config" cc ON cc."edition_id" = b."edition_id"
WHERE r."zone_code" IS NULL;

DROP TABLE _band;

-- The banded rows have served their purpose.
DELETE FROM "stalls"."stall_rate_card" WHERE "zone_code" IS NULL;

ALTER TABLE "stalls"."stall_rate_card"
  ALTER COLUMN "zone_code"     SET NOT NULL,
  ALTER COLUMN "scope"         SET NOT NULL,
  ALTER COLUMN "deposit_paise" SET NOT NULL;

DROP INDEX IF EXISTS "stalls"."stall_rate_card_edition_id_zone_group_is_food_key";
ALTER TABLE "stalls"."stall_rate_card" DROP COLUMN "zone_group";
CREATE UNIQUE INDEX "stall_rate_card_edition_id_zone_code_is_food_scope_key"
  ON "stalls"."stall_rate_card"("edition_id", "zone_code", "is_food", "scope");

DROP TYPE "stalls"."StallZoneGroup";

-- The advance is area-wise now, so the two flat figures have no meaning left.
ALTER TABLE "stalls"."stall_charge_config"
  DROP COLUMN "vendor_deposit_paise",
  DROP COLUMN "local_welfare_deposit_paise";

-- ── The agreed bay ──────────────────────────────────────────────────────────

ALTER TABLE "stalls"."stall_request" ADD COLUMN "agreed_zone_code" TEXT;

-- A request already holding a stall has had its bay settled by definition.
UPDATE "stalls"."stall_request" r
SET "agreed_zone_code" = z."code"
FROM "stalls"."stall_allocation" a, "stalls"."stall" s, "stalls"."stall_zone" z
WHERE a."request_id" = r."id"
  AND a."released_at" IS NULL
  AND a."stall_id" = s."id"
  AND s."zone_id" = z."id";

-- ── The coupon's own capacity ───────────────────────────────────────────────

ALTER TABLE "stalls"."stall_staff_coupon" ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 8;

-- A coupon already issued keeps whatever the vendor asked for, where that was a
-- real number; the rest take the team's default of eight. The old cap read the
-- request's staff-pass count and treated zero as "no limit", which is how a
-- stall with eight passes could register eighty.
UPDATE "stalls"."stall_staff_coupon" c
SET "capacity" = GREATEST(r."passes_staff", 8)
FROM "stalls"."stall_request" r
WHERE c."request_id" = r."id";

-- ── The discretionary fee ───────────────────────────────────────────────────

ALTER TABLE "stalls"."stall_payment_plan"
  ADD COLUMN "discretionary_fee_paise" INTEGER,
  ADD COLUMN "discretionary_reason"    TEXT,
  ADD COLUMN "discretionary_set_at"    TIMESTAMPTZ,
  ADD COLUMN "discretionary_set_by"    TEXT;

-- ── Letters gain a channel ──────────────────────────────────────────────────

ALTER TABLE "stalls"."stall_email_log" RENAME TO "stall_message_log";
ALTER TABLE "stalls"."stall_message_log" RENAME COLUMN "to_email" TO "sent_to";
ALTER TABLE "stalls"."stall_message_log"
  ADD COLUMN "channel" "stalls"."StallMessageChannel" NOT NULL DEFAULT 'EMAIL';

ALTER INDEX "stalls"."stall_email_log_pkey" RENAME TO "stall_message_log_pkey";
DROP INDEX IF EXISTS "stalls"."stall_email_log_request_id_template_key_key";
DROP INDEX IF EXISTS "stalls"."stall_email_log_template_key_sent_at_idx";
CREATE UNIQUE INDEX "stall_message_log_request_id_template_key_channel_key"
  ON "stalls"."stall_message_log"("request_id", "template_key", "channel");
CREATE INDEX "stall_message_log_template_key_sent_at_idx"
  ON "stalls"."stall_message_log"("template_key", "sent_at");

ALTER TABLE "stalls"."stall_message_log"
  RENAME CONSTRAINT "stall_email_log_request_id_fkey" TO "stall_message_log_request_id_fkey";

-- ── The signed agreement ────────────────────────────────────────────────────

CREATE TABLE "stalls"."stall_contract_signature" (
  "request_id"  UUID    NOT NULL,
  "status"      "stalls"."StallSignatureStatus" NOT NULL DEFAULT 'NOT_SENT',
  "provider"    TEXT    NOT NULL,
  "document_id" TEXT,
  "sign_url"    TEXT,
  "sent_at"     TIMESTAMPTZ,
  "sent_by"     TEXT,
  "signed_at"   TIMESTAMPTZ,
  "error"       TEXT,
  "updated_at"  TIMESTAMPTZ NOT NULL,
  CONSTRAINT "stall_contract_signature_pkey" PRIMARY KEY ("request_id")
);
CREATE INDEX "stall_contract_signature_status_idx"
  ON "stalls"."stall_contract_signature"("status");
ALTER TABLE "stalls"."stall_contract_signature"
  ADD CONSTRAINT "stall_contract_signature_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE;

-- The WhatsApp wording, beside the email body it accompanies.
ALTER TABLE "stalls"."stall_email_template"
  ADD COLUMN "whatsapp_body" TEXT NOT NULL DEFAULT '';
