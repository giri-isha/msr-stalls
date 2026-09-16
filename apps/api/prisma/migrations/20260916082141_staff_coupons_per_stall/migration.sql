-- A stall may hold SEVERAL staff coupons, not one.
--
-- "If they want more staff members, in the back end we raise that capacity to
-- 10, 12" was the only answer the model allowed, because `request_id` WAS the
-- primary key. The team also wants to hand a caterer their own code, separate
-- from the vendor's own kitchen team, and count the two apart. That needs a
-- coupon to be a row in its own right.
--
-- Hand-written: Prisma cannot add a required `id` to a table that already has
-- rows, and the whole change is a primary-key move it will not derive.

-- ── stall_staff_coupon: request_id stops being the key ──────────────────────

ALTER TABLE "stalls"."stall_staff_coupon" ADD COLUMN "id" UUID;

-- Every coupon that already exists keeps its code, its capacity and its
-- registrations; it just gains an identity of its own.
UPDATE "stalls"."stall_staff_coupon" SET "id" = gen_random_uuid() WHERE "id" IS NULL;

ALTER TABLE "stalls"."stall_staff_coupon" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "stalls"."stall_staff_coupon" DROP CONSTRAINT "stall_staff_coupon_pkey";
ALTER TABLE "stalls"."stall_staff_coupon" ADD CONSTRAINT "stall_staff_coupon_pkey" PRIMARY KEY ("id");

-- `request_id` is now an ordinary foreign key, and deliberately NOT unique:
-- that uniqueness is precisely what this migration removes.
CREATE INDEX "stall_staff_coupon_request_id_idx" ON "stalls"."stall_staff_coupon"("request_id");

-- ── stall_vendor_staff: which coupon did this person come in on ─────────────

ALTER TABLE "stalls"."stall_vendor_staff" ADD COLUMN "coupon_id" UUID;

-- Backfill: before this migration a stall had at most one coupon, so every
-- existing registration can only have come in on that one.
UPDATE "stalls"."stall_vendor_staff" s
   SET "coupon_id" = c."id"
  FROM "stalls"."stall_staff_coupon" c
 WHERE c."request_id" = s."request_id";

-- ⚠️ SET NULL, not CASCADE. Retiring a coupon must never delete the people who
-- registered on it — some are holding wristbands, and the gate checks the
-- roster, not the code they arrived through.
ALTER TABLE "stalls"."stall_vendor_staff"
  ADD CONSTRAINT "stall_vendor_staff_coupon_id_fkey"
  FOREIGN KEY ("coupon_id") REFERENCES "stalls"."stall_staff_coupon"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "stall_vendor_staff_coupon_id_idx" ON "stalls"."stall_vendor_staff"("coupon_id");
