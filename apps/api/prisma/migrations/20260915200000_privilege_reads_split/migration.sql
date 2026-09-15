-- Splitting the reads out of the writes, and chairs-and-tables out of check-in.
--
-- Six new codes: comms.read, onboarding.read, onboarding.write, checkin.read,
-- equipment.read, equipment.write. `seedRbac` upserts the vocabulary too, but
-- the rows have to exist HERE because the statements below reference them, and
-- a migration that depends on application code having run first is a migration
-- that fails on a fresh deploy.
--
-- `sort_order` is left at the end of the list; the seed rewrites it to the
-- catalogue's own order on the next boot, and nothing reads it in between.
INSERT INTO "stalls"."stall_privilege" ("id", "code", "label", "category", "kind", "description", "sort_order")
VALUES
  (gen_random_uuid(), 'comms.read', 'View letters and what has been sent', 'comms', 'view',
   'The letter templates, the recipient list, and the log of reminder calls.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "stalls"."stall_privilege")),
  (gen_random_uuid(), 'onboarding.read', 'View onboarding', 'onboarding', 'view',
   'What each selected stall still owes: bank form, contract, FSSAI, staff.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 2 FROM "stalls"."stall_privilege")),
  (gen_random_uuid(), 'onboarding.write', 'Issue coupons and verify documents', 'onboarding', 'action',
   'Issue a staff coupon and set what it admits, tick an FSSAI certificate as seen, and remove a staff registration.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 3 FROM "stalls"."stall_privilege")),
  (gen_random_uuid(), 'checkin.read', 'View the check-in list', 'checkin', 'view',
   'Who has arrived, who has not, and what is outstanding against them.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 4 FROM "stalls"."stall_privilege")),
  (gen_random_uuid(), 'equipment.read', 'View chairs and tables', 'equipment', 'view',
   'What each stall is owed, what it has taken, and what came back.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 5 FROM "stalls"."stall_privilege")),
  (gen_random_uuid(), 'equipment.write', 'Distribute, collect and charge', 'equipment', 'action',
   'Hand furniture out, take cash for extras, print a challan, and record what returned short or damaged.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 6 FROM "stalls"."stall_privilege"))
ON CONFLICT ("code") DO NOTHING;

-- ── Keeping authored roles working ──────────────────────────────────────────
--
-- ⚠️ `is_system = false` ONLY. The six shipped roles are owned by `SEED_ROLES`
-- and `seedRbac` rewrites their bundles wholesale on the next boot, so touching
-- them here would be undone a moment later — and in one case wrongly: the
-- Volunteer role is DELIBERATELY narrowed by this change and must not have
-- `onboarding.read` handed back to it on the way past.
--
-- For a role an admin composed, the rule is the opposite: it must mean on
-- Monday what it meant on Friday. These three statements are that promise.

-- Chairs and tables used to be inside `checkin.write`.
INSERT INTO "stalls"."stall_role_privilege" ("role_id", "privilege_id")
SELECT r."id", new_p."id"
FROM "stalls"."stall_role" r
JOIN "stalls"."stall_role_privilege" rp ON rp."role_id" = r."id"
JOIN "stalls"."stall_privilege" p ON p."id" = rp."privilege_id" AND p."code" = 'checkin.write'
CROSS JOIN LATERAL (SELECT "id" FROM "stalls"."stall_privilege" WHERE "code" = 'equipment.write') new_p
WHERE r."is_system" = false
ON CONFLICT DO NOTHING;

-- The onboarding screen used to be gated on `requests.read` …
INSERT INTO "stalls"."stall_role_privilege" ("role_id", "privilege_id")
SELECT r."id", new_p."id"
FROM "stalls"."stall_role" r
JOIN "stalls"."stall_role_privilege" rp ON rp."role_id" = r."id"
JOIN "stalls"."stall_privilege" p ON p."id" = rp."privilege_id" AND p."code" = 'requests.read'
CROSS JOIN LATERAL (SELECT "id" FROM "stalls"."stall_privilege" WHERE "code" = 'onboarding.read') new_p
WHERE r."is_system" = false
ON CONFLICT DO NOTHING;

-- … and its writes on `requests.write`.
INSERT INTO "stalls"."stall_role_privilege" ("role_id", "privilege_id")
SELECT r."id", new_p."id"
FROM "stalls"."stall_role" r
JOIN "stalls"."stall_role_privilege" rp ON rp."role_id" = r."id"
JOIN "stalls"."stall_privilege" p ON p."id" = rp."privilege_id" AND p."code" = 'requests.write'
CROSS JOIN LATERAL (SELECT "id" FROM "stalls"."stall_privilege" WHERE "code" = 'onboarding.write') new_p
WHERE r."is_system" = false
ON CONFLICT DO NOTHING;

-- ⚠️ No statement grants `comms.read`, `checkin.read` or `equipment.read` to
-- anything. A write implies its read — see `IMPLIED_READ` in
-- `packages/stalls/src/rbac.ts` — so a role holding `comms.write` already
-- reaches `comms.read`, and writing the row as well would put the same rule in
-- two places that can then disagree.

-- The check-in privilege no longer covers the furniture; its wording said it did.
UPDATE "stalls"."stall_privilege"
SET "description" = 'Record an arrival or reverse one.'
WHERE "code" = 'checkin.write';
