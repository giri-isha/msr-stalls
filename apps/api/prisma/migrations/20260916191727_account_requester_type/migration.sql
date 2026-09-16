-- Which of the three forms an account may fill. Asked at registration from
-- here on; nullable because the accounts below it pre-date the question.
-- AlterTable
ALTER TABLE "stalls"."stall_account" ADD COLUMN     "requester_type" "stalls"."StallRequestType";

-- An account that has already FILED has answered this question by filing: it
-- came in through one of the three forms, and that is what it is. Backfilled
-- from the FIRST request, so an account the team later filed a second type
-- against keeps the type it registered under rather than the most recent one.
--
-- What is left null afterwards is an account that has never applied, and there
-- is nothing to infer for one — the apply page offers all three forms until it
-- submits, and the submission writes the answer.
UPDATE "stalls"."stall_account" a
SET "requester_type" = first."request_type"
FROM (
  SELECT DISTINCT ON ("account_id") "account_id", "request_type"
  FROM "stalls"."stall_request"
  ORDER BY "account_id", "submitted_at" ASC, "id" ASC
) AS first
WHERE first."account_id" = a."id" AND a."requester_type" IS NULL;
