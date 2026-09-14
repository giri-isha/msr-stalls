-- The third chair/table rate pair.
--
-- The charge config carried an ashram pair and a local welfare pair. The bill
-- picked the ashram pair for everyone who was not local welfare — which in
-- practice meant vendors, because ashram departments are exempt and return
-- before the furniture lines are priced at all. So a vendor was quoted
-- Rs.50/chair from a form that was never addressed to them.
--
-- The 2025 bank-details form quotes the vendor Rs.100/chair and Rs.400/table
-- per day. Defaults carry those figures; an admin sets them per edition after.
ALTER TABLE "stalls"."stall_charge_config"
  ADD COLUMN "vendor_chair_rate_paise" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN "vendor_table_rate_paise" INTEGER NOT NULL DEFAULT 40000;
