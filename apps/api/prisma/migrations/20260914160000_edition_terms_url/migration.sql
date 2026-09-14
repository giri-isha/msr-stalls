-- Where this season's terms and conditions can be read.
--
-- The bank form records `agreed_terms_at` against a tick-box, and the 2025 form
-- that tick-box came from put a link beside it — "to view the terms and
-- conditions document, please click here". Without it a requester accepts terms
-- they were never shown.
--
-- Null until the legal team issues the season's document.
ALTER TABLE "stalls"."stall_edition" ADD COLUMN "terms_url" TEXT;
