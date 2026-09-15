-- The rank an admin types on a role, 0 being the top.
--
-- Stored rather than derived by walking parent_key. It is a LABEL: who may hand
-- out which role is decided by the tree and nothing else, so a level that
-- disagrees with the parent chain changes nobody's reach.
ALTER TABLE "stalls"."stall_role" ADD COLUMN "level" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the depth the API used to derive, so nothing moves on the day
-- the column arrives. Four levels is deeper than the shipped tree goes.
WITH RECURSIVE tree AS (
  SELECT role_key, 0 AS depth FROM "stalls"."stall_role" WHERE parent_key IS NULL
  UNION ALL
  SELECT r.role_key, t.depth + 1
  FROM "stalls"."stall_role" r
  JOIN tree t ON r.parent_key = t.role_key
)
UPDATE "stalls"."stall_role" r
SET "level" = LEAST(t.depth, 9)
FROM tree t
WHERE t.role_key = r.role_key;
