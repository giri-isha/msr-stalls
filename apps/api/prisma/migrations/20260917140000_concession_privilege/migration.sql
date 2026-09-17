-- Agreeing the fee is its own privilege.
--
-- 🔴 `finance.write` covered two different acts. One is matching a credit
-- against a bank statement; the other is "for A3 the cost is 10,000 — for the
-- coconut wala, probably we will give that stall at 5,000", which is a
-- judgement made while negotiating with the trader, in the same conversation as
-- the bay and the number of stalls.
--
-- Folded together, the people who actually agree the figure could not record
-- it: a Lead runs the selection and holds `finance.read` only, so the number
-- had to be carried to Finance afterwards — which meant it was usually not
-- carried at all.
--
-- ⚠️ The row has to exist HERE, not only in `seedRbac`. The grants below
-- reference it, and a migration that depends on application code having run
-- first is a migration that fails on a fresh deploy.
--
-- `sort_order` is left at the end; the seed rewrites it to the catalogue's own
-- order on the next boot, and nothing reads it in between.
INSERT INTO "stalls"."stall_privilege" ("id", "code", "label", "category", "kind", "description", "sort_order")
VALUES
  (gen_random_uuid(), 'concession.write', 'Agree a different fee for one stall', 'finance', 'action',
   'Record the fee agreed with one requester where it differs from the rate card, and the reason it was reduced. The quoted figure is kept beside it.',
   (SELECT COALESCE(MAX("sort_order"), 0) + 1 FROM "stalls"."stall_privilege"))
ON CONFLICT ("code") DO NOTHING;

-- ── What already-composed roles keep ───────────────────────────────────────
--
-- ⚠️ `is_system = false` only. The shipped roles have their bundles REWRITTEN
-- from `SEED_ROLES` by `seedRbac` on the next boot, so granting to them here
-- would be undone and would put the same decision in two places. Lead, Finance
-- and Local Welfare gain it there.
--
-- For a role an admin composed, the rule is the opposite: it must mean on
-- Monday what it meant on Friday. Anybody who could set an agreed fee
-- yesterday — which meant holding `finance.write` — can still set one today.
INSERT INTO "stalls"."stall_role_privilege" ("role_id", "privilege_id")
SELECT r."id", new_p."id"
FROM "stalls"."stall_role" r
JOIN "stalls"."stall_role_privilege" rp ON rp."role_id" = r."id"
JOIN "stalls"."stall_privilege" p ON p."id" = rp."privilege_id" AND p."code" = 'finance.write'
CROSS JOIN LATERAL (SELECT "id" FROM "stalls"."stall_privilege" WHERE "code" = 'concession.write') new_p
WHERE r."is_system" = false
ON CONFLICT DO NOTHING;

-- `finance.write` no longer covers the agreed fee; its wording said it did not
-- either, but it is worth being explicit now that a second code exists.
UPDATE "stalls"."stall_privilege"
SET "description" = 'Match a credit to a request and confirm it. Agreeing a reduced fee is separate — see Agree a different fee for one stall.'
WHERE "code" = 'finance.write';
