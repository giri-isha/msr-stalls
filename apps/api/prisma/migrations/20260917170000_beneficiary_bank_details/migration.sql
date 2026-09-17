-- Who the money goes to, as configuration rather than as prose.
--
-- The beneficiary identity — account name, address, account type, bank, IFSC,
-- branch — lived in the body of the PAYMENT_DETAILS email template, which is a
-- row an admin edits. That was deliberate: the team changes banks without a
-- deploy, and an editable template is what let them.
--
-- 🔴 It stops working the moment the vendor's own payment page has to name the
-- same bank. A page that knows the account number and not the IFSC is a page a
-- vendor cannot transfer from, and a second copy of the identity is one bank
-- change away from a letter and a page naming different beneficiaries — a
-- transfer into a closed account is money somebody has to trace.
--
-- ⚠️ Nullable, every one. An edition that has not been told prints nothing; it
-- must never fall back to last year's bank. `copyEdition` leaves them behind
-- for the same reason it leaves the virtual-account prefixes behind — Finance
-- issues both per edition.
ALTER TABLE "stalls"."stall_edition"
  ADD COLUMN "beneficiary_name"    TEXT,
  ADD COLUMN "beneficiary_address" TEXT,
  ADD COLUMN "bank_account_type"   TEXT,
  ADD COLUMN "bank_name"           TEXT,
  ADD COLUMN "bank_ifsc"           TEXT,
  ADD COLUMN "bank_branch"         TEXT;
