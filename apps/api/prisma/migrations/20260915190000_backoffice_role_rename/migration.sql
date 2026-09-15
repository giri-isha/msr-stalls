-- "Staff" meant two populations in one word: the team running the stalls, and
-- the people a vendor registers to work at their own stall. The team is the
-- BACKOFFICE now, and the word "staff" is left to the vendor alone — which is
-- why `stall_staff_coupon` and `stall_vendor_staff` are untouched here.
--
-- A rename and nothing else: same columns, same rows, same foreign key. The
-- constraints and indexes are renamed with the table because Prisma derives
-- their names from it, and a database whose constraint is still called
-- `stall_staff_role_pkey` drifts from the schema on the next `migrate dev`.
ALTER TABLE "stalls"."stall_staff_role" RENAME TO "stall_backoffice_role";

ALTER INDEX "stalls"."stall_staff_role_pkey" RENAME TO "stall_backoffice_role_pkey";
ALTER INDEX "stalls"."stall_staff_role_person_ref_role_key_key" RENAME TO "stall_backoffice_role_person_ref_role_key_key";
ALTER INDEX "stalls"."stall_staff_role_role_key_idx" RENAME TO "stall_backoffice_role_role_key_idx";

ALTER TABLE "stalls"."stall_backoffice_role"
  RENAME CONSTRAINT "stall_staff_role_role_key_fkey" TO "stall_backoffice_role_role_key_fkey";

-- The label on the privilege that hands out access says "staff member" too.
-- The vocabulary is reference data the seed tops up, so this is belt and
-- braces for a database that will not be re-seeded before somebody reads it.
UPDATE "stalls"."stall_privilege"
SET "description" = 'Add a backoffice member, grant a role, and revoke one.'
WHERE "code" = 'users.write';
