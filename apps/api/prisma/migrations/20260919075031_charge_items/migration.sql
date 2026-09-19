-- Chargeable items beyond chairs and tables, and the days the furniture was
-- actually out.
--
-- Three things land together because they are one change on the screen: the
-- Charges page becomes a matrix of items against requester types, so anything
-- the counter lends needs a row in it; the shared damage penalty needs to stop
-- being shared before it can be drawn as a cell; and what the counter hands out
-- beyond the order takes one day's cash and settles the rest at return.

-- 🔴 One damage figure PER ROW. `damage_penalty_paise` was charged for a broken
-- chair and a broken table alike. On a screen that lays items out as rows that
-- is a cell whose edit silently moves the row below it — so it is split, and
-- BOTH columns are backfilled from the old one. Nothing reprices today: every
-- edition carries the same figure in both columns until somebody changes one.
ALTER TABLE "stalls"."stall_charge_config"
  ADD COLUMN "chair_damage_paise" INTEGER NOT NULL DEFAULT 25000,
  ADD COLUMN "table_damage_paise" INTEGER NOT NULL DEFAULT 25000;

UPDATE "stalls"."stall_charge_config"
   SET "chair_damage_paise" = "damage_penalty_paise",
       "table_damage_paise" = "damage_penalty_paise";

ALTER TABLE "stalls"."stall_charge_config" DROP COLUMN "damage_penalty_paise";

-- The catalogue. Rates default to 0 rather than NULL: an item a requester type
-- is not charged for is free, which is a price, where NULL would be a question
-- every caller has to answer again.
--
-- ⚠️ No DEFAULT on `id`, deliberately. The Prisma schema says `@default(uuid())`,
-- which is generated in the APPLICATION — a `gen_random_uuid()` default here
-- reads as drift, and Prisma answers drift by generating a migration to drop it
-- again. The repo already carries two of those. A hand-written INSERT in a
-- migration therefore has to supply its own id.
CREATE TABLE "stalls"."stall_charge_item" (
  "id"                UUID    NOT NULL,
  "edition_id"        UUID    NOT NULL,
  "key"               TEXT    NOT NULL,
  "name"              TEXT    NOT NULL,
  "ashram_rate_paise" INTEGER NOT NULL DEFAULT 0,
  "lw_rate_paise"     INTEGER NOT NULL DEFAULT 0,
  "vendor_rate_paise" INTEGER NOT NULL DEFAULT 0,
  "per_day"           BOOLEAN NOT NULL DEFAULT true,
  "missing_paise"     INTEGER NOT NULL DEFAULT 0,
  "damaged_paise"     INTEGER NOT NULL DEFAULT 0,
  "is_active"         BOOLEAN NOT NULL DEFAULT true,
  "sort_order"        INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "stall_charge_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stall_charge_item_edition_id_key_key"
  ON "stalls"."stall_charge_item" ("edition_id", "key");

ALTER TABLE "stalls"."stall_charge_item"
  ADD CONSTRAINT "stall_charge_item_edition_id_fkey"
  FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- What one stall took of one item, and what came back wrong.
--
-- ⚠️ RESTRICT on the item, not CASCADE: deleting a fan from the catalogue must
-- not delete the record that a vendor was handed two of them. Retiring sets
-- `is_active` instead, and every row stays readable.
CREATE TABLE "stalls"."stall_equipment_issue_item" (
  "id"         UUID    NOT NULL,
  "request_id" UUID    NOT NULL,
  "item_id"    UUID    NOT NULL,
  "count"      INTEGER NOT NULL DEFAULT 0,
  "missing"    INTEGER NOT NULL DEFAULT 0,
  "damaged"    INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "stall_equipment_issue_item_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stall_equipment_issue_item_request_id_item_id_key"
  ON "stalls"."stall_equipment_issue_item" ("request_id", "item_id");

CREATE INDEX "stall_equipment_issue_item_item_id_idx"
  ON "stalls"."stall_equipment_issue_item" ("item_id");

ALTER TABLE "stalls"."stall_equipment_issue_item"
  ADD CONSTRAINT "stall_equipment_issue_item_request_id_fkey"
  FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_equipment_issue" ("request_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stalls"."stall_equipment_issue_item"
  ADD CONSTRAINT "stall_equipment_issue_item_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "stalls"."stall_charge_item" ("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Defaults to 1, which is what every existing row was charged for: the counter
-- took one day's cash for extras and nothing settled afterwards. Backdating a
-- larger figure onto rows already refunded would invent a debt nobody raised.
ALTER TABLE "stalls"."stall_equipment_issue"
  ADD COLUMN "days_held" INTEGER NOT NULL DEFAULT 1;

-- 🔴 GST splits THREE ways, because the decision is made three times. Rent is
-- taxed; whether the furniture is taxed is a separate call the team makes each
-- year; and a refundable deposit is not a supply at all, so its rate is seeded
-- at zero rather than assumed.
--
-- Rent and items are both backfilled from the old single rate, and deposit is
-- zero, which is exactly what the old arithmetic did — GST was added to the
-- fee net (stall + plugs + furniture) and never to the deposits. Nothing
-- reprices on the day this lands.
ALTER TABLE "stalls"."stall_charge_config"
  RENAME COLUMN "gst_percent" TO "gst_rent_percent";

ALTER TABLE "stalls"."stall_charge_config"
  ADD COLUMN "gst_items_percent"   INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "gst_deposit_percent" INTEGER NOT NULL DEFAULT 0;

UPDATE "stalls"."stall_charge_config"
   SET "gst_items_percent" = "gst_rent_percent";

-- Whether the chair and table rates are DAILY rates at all, which until now was
-- assumed. Both default to true, which is what the arithmetic already did and
-- what the 2025 forms quote — nothing reprices. The alternative, for a year the
-- team charges a flat rate, was to halve the rate and set the days to one:
-- correct arithmetic and a payment letter that reads as a lie.
ALTER TABLE "stalls"."stall_charge_config"
  ADD COLUMN "chair_per_day" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "table_per_day" BOOLEAN NOT NULL DEFAULT true;
