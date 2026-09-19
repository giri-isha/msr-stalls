-- An HTML version of each letter, edited beside the plain text.
--
-- 🔴 Alongside `body`, never instead of it. Every send stays multipart: the
-- text part is what a feature phone, a plain-text client and our own WhatsApp
-- wording already carry, and losing it to a styled version would silently
-- downgrade the readers least able to complain.
--
-- Empty by default, which is what every existing edition gets — the letters
-- keep going out as plain text until somebody writes the HTML for one.
ALTER TABLE "stalls"."stall_email_template"
  ADD COLUMN "html_body" TEXT NOT NULL DEFAULT '';
