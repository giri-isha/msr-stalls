-- The WhatsApp wording for a letter. The selection confirmation goes out on
-- both channels — "we would like to send them a WhatsApp message, as well as
-- an email" — and the two are not the same text: one carries an attachment and
-- reads as a letter, the other has to read on a phone.
--
-- Empty means the template is email-only, which the send path treats as an
-- absence rather than a failure, so every existing row defaults to that.
ALTER TABLE "stalls"."stall_email_template" ADD COLUMN "whatsapp_body" TEXT NOT NULL DEFAULT '';
