-- Registration is no longer confirmed. A credential works the moment it is
-- created, so the column that gated login on a followed link goes, and with it
-- every link minted to set it.
--
-- ⚠️ Dropping the column is also the backfill: the 16 rows that had never been
-- confirmed could not log in, and now can. That is the point of the change —
-- no mail service is wired up, so no one could follow a link in the first
-- place.
--
-- ⚠️ The `REGISTER_CONFIRM` value stays in "StallAccessPurpose". Postgres
-- cannot drop an enum value without recreating the type, and recreating it
-- would rewrite every access link to buy nothing. Nothing mints one any more.
DELETE FROM "stalls"."stall_access_link" WHERE "purpose" = 'REGISTER_CONFIRM';

ALTER TABLE "stalls"."stall_credential" DROP COLUMN "confirmed_at";
