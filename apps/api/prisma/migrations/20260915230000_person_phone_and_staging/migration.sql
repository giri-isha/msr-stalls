-- A backoffice member gets a number, and a person can be added before they arrive.
--
-- ⚠️ BOTH COLUMNS ARE ON A FOUNDATION STUB, so neither ships. The host's real
-- `person` already has `phone`; its equivalent of `staged` is a null `sso_id`.
-- This migration exists so the stub can carry what the host carries — see the
-- model's own notes and `docs/migration-to-host.md`.

ALTER TABLE "foundation"."person" ADD COLUMN "phone" TEXT;

-- Default false, so every row that already exists reads as a person who is
-- really here. Staging is something an admin does deliberately; it is never
-- what a backfill should assert about somebody who has been signing in for a year.
ALTER TABLE "foundation"."person" ADD COLUMN "staged" BOOLEAN NOT NULL DEFAULT false;
