-- 🔴 "Users can choose up to 10 stalls in a request, but only two requests at a
-- time." The first half of that rule already existed as a column; the second
-- half did not exist at all. Nothing anywhere bounded how many requests one
-- account could file — a vendor who wanted six bays filed six requests, and the
-- per-bay cap of two was the only thing that ever looked like a limit.
--
-- So the per-request cap moves to where the rule actually puts it, and the
-- limit that was doing the work in people's heads becomes a column.

-- Which of an account's own requests count against the new cap. Three honest
-- readings of "at a time", chosen per edition rather than decided here: see the
-- comment on the enum in schema.prisma.
CREATE TYPE "stalls"."StallRequestCapScope" AS ENUM ('UNDECIDED', 'OPEN', 'ALL');

ALTER TABLE "stalls"."stall_edition"
  ADD COLUMN "max_open_requests" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "request_cap_scope" "stalls"."StallRequestCapScope" NOT NULL DEFAULT 'OPEN';

-- ⚠️ The DEFAULT changes AND the existing rows move. Leaving them at 2 would
-- mean the rule the team stated is not the rule the live edition enforces, and
-- an edition still refusing a third stall is not a state anybody asked for —
-- it is the old rule surviving the migration that replaced it.
--
-- Only rows still sitting on the old default move. An edition an admin has
-- already tuned to some other figure is a decision, not a leftover.
ALTER TABLE "stalls"."stall_edition" ALTER COLUMN "max_stalls_per_request" SET DEFAULT 10;
UPDATE "stalls"."stall_edition" SET "max_stalls_per_request" = 10 WHERE "max_stalls_per_request" = 2;
