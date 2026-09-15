-- CreateTable
CREATE TABLE "stalls"."stall_privilege" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_privilege_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_role" (
    "id" UUID NOT NULL,
    "role_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "parent_key" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "all_privileges" BOOLEAN NOT NULL DEFAULT false,
    "can_assign_same_level" BOOLEAN NOT NULL DEFAULT false,
    "request_type_scope" TEXT[],
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stall_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_role_privilege" (
    "role_id" UUID NOT NULL,
    "privilege_id" UUID NOT NULL,

    CONSTRAINT "stall_role_privilege_pkey" PRIMARY KEY ("role_id","privilege_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_privilege_code_key" ON "stalls"."stall_privilege"("code");

-- CreateIndex
CREATE UNIQUE INDEX "stall_role_role_key_key" ON "stalls"."stall_role"("role_key");

-- CreateIndex
CREATE INDEX "stall_role_parent_key_idx" ON "stalls"."stall_role"("parent_key");

-- CreateIndex
CREATE INDEX "stall_role_privilege_privilege_id_idx" ON "stalls"."stall_role_privilege"("privilege_id");

-- CreateIndex
CREATE INDEX "stall_staff_role_role_key_idx" ON "stalls"."stall_staff_role"("role_key");

-- AddForeignKey
ALTER TABLE "stalls"."stall_role" ADD CONSTRAINT "stall_role_parent_key_fkey" FOREIGN KEY ("parent_key") REFERENCES "stalls"."stall_role"("role_key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_role_privilege" ADD CONSTRAINT "stall_role_privilege_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "stalls"."stall_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_role_privilege" ADD CONSTRAINT "stall_role_privilege_privilege_id_fkey" FOREIGN KEY ("privilege_id") REFERENCES "stalls"."stall_privilege"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────────
-- The vocabulary and the six shipped roles, written HERE rather than left to
-- the seed script.
--
-- `stall_staff_role.role_key` gains a foreign key at the bottom of this file,
-- and every existing grant names one of these six roles. Seeding them from
-- `prisma/seed.ts` instead would mean the constraint is added against an empty
-- `stall_role` and every existing grant violates it — the migration would fail
-- on any database that has ever been used. So the rows land first, in the same
-- transaction, and the seed becomes idempotent top-up rather than the only
-- source.
--
-- Kept in step with `PRIVILEGE_CATEGORIES` and `SEED_ROLES` in
-- `packages/stalls/src/rbac.ts`; the seed upserts from those constants, so a
-- later edit there reaches an existing database by re-running the seed.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO "stalls"."stall_privilege" ("id", "code", "label", "category", "kind", "description", "sort_order") VALUES
  (gen_random_uuid(), 'requests.read',    'View requests',                    'requests',   'view',      'Open the request list and any request record.', 0),
  (gen_random_uuid(), 'requests.write',   'File and amend requests',          'requests',   'action',    'Enter a request on behalf of a trader, and amend one.', 1),
  (gen_random_uuid(), 'planning.read',    'View the planning grid',           'planning',   'view',      'The bay-by-bay plan and what is allotted where.', 2),
  (gen_random_uuid(), 'planning.write',   'Plan and allot stalls',            'planning',   'action',    'Write a zone plan, apply it, and move allotments.', 3),
  (gen_random_uuid(), 'electrical.read',  'View the electrical sheet',        'electrical', 'view',      'The stall-wise electrical and layout sheet, and the bay list.', 4),
  (gen_random_uuid(), 'selection.read',   'View shortlisting and selection',  'selection',  'view',      'Who is shortlisted, selected, waitlisted or declined.', 5),
  (gen_random_uuid(), 'selection.write',  'Shortlist, select and decline',    'selection',  'action',    'Move a request through selection, and reverse it.', 6),
  (gen_random_uuid(), 'comms.write',      'Send messages and reminders',      'comms',      'action',    'Send a templated email or WhatsApp message, and log a reminder.', 7),
  (gen_random_uuid(), 'finance.read',     'View payments and bank details',   'finance',    'sensitive', 'Payment status, the virtual accounts, and a requester''s bank details.', 8),
  (gen_random_uuid(), 'finance.write',    'Confirm payments',                 'finance',    'action',    'Match a credit to a request and confirm it.', 9),
  (gen_random_uuid(), 'refunds.write',    'Issue refunds',                    'finance',    'action',    'Return the refundable advance at the end of the season.', 10),
  (gen_random_uuid(), 'checkin.write',    'Check stalls in and out',          'checkin',    'action',    'Arrival, departure, and the chairs and tables issued against a stall.', 11),
  (gen_random_uuid(), 'config.read',      'View configuration',               'config',     'view',      'Editions, zones, rate cards, charges, fines and form fields.', 12),
  (gen_random_uuid(), 'config.write',     'Change configuration',             'config',     'config',    'Create an edition and set the rates, charges and forms it runs on.', 13),
  (gen_random_uuid(), 'users.write',      'Grant and revoke access',          'access',     'config',    'Add a staff member, grant a role, and revoke one.', 14);

-- Admin first: the others reference it by `parent_key`.
INSERT INTO "stalls"."stall_role" ("id", "role_key", "name", "description", "parent_key", "is_system", "all_privileges", "can_assign_same_level", "request_type_scope", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'stalls_admin', 'Admin', 'Full access, including module configuration', NULL, true, true, true, '{}', 0, CURRENT_TIMESTAMP);

INSERT INTO "stalls"."stall_role" ("id", "role_key", "name", "description", "parent_key", "is_system", "all_privileges", "can_assign_same_level", "request_type_scope", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'stalls_lead', 'Lead (Stall Coordinator)', 'Planning, selection, communication and finance visibility', 'stalls_admin', true, false, false, '{}', 1, CURRENT_TIMESTAMP);

INSERT INTO "stalls"."stall_role" ("id", "role_key", "name", "description", "parent_key", "is_system", "all_privileges", "can_assign_same_level", "request_type_scope", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'stalls_volunteer',     'Volunteer',               'Check-in, chairs and tables',                                'stalls_lead', true, false, false, '{}', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'stalls_finance',       'Finance',                 'Payment confirmation and refunds',                           'stalls_lead', true, false, false, '{}', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'stalls_electrical',    'Electrical & Venue Prep', 'The stall-wise electrical and layout sheet, read only',       'stalls_lead', true, false, false, '{}', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'stalls_local_welfare', 'Local Welfare',           'Files and follows up local welfare stalls, and nothing else', 'stalls_lead', true, false, false, '{LOCAL_WELFARE}', 5, CURRENT_TIMESTAMP);

-- Admin gets no rows: `all_privileges` resolves against the live privilege
-- table, which is what lets a privilege added later reach it with no seed edit.
INSERT INTO "stalls"."stall_role_privilege" ("role_id", "privilege_id")
SELECT r."id", p."id"
FROM "stalls"."stall_role" r
JOIN "stalls"."stall_privilege" p ON p."code" = ANY (
  CASE r."role_key"
    WHEN 'stalls_lead' THEN ARRAY[
      'requests.read', 'requests.write', 'planning.read', 'planning.write',
      'electrical.read', 'selection.read', 'selection.write', 'comms.write',
      'finance.read', 'config.read', 'refunds.write']
    WHEN 'stalls_volunteer'     THEN ARRAY['requests.read', 'checkin.write']
    WHEN 'stalls_finance'       THEN ARRAY['requests.read', 'finance.read', 'finance.write']
    WHEN 'stalls_electrical'    THEN ARRAY['electrical.read']
    WHEN 'stalls_local_welfare' THEN ARRAY['requests.read', 'requests.write', 'selection.read', 'finance.read']
    ELSE ARRAY[]::TEXT[]
  END
);

-- AddForeignKey
ALTER TABLE "stalls"."stall_staff_role" ADD CONSTRAINT "stall_staff_role_role_key_fkey" FOREIGN KEY ("role_key") REFERENCES "stalls"."stall_role"("role_key") ON DELETE RESTRICT ON UPDATE CASCADE;
