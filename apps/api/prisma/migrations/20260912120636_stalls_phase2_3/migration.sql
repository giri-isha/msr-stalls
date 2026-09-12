-- CreateEnum
CREATE TYPE "stalls"."StallEmailTemplateKey" AS ENUM ('SELECTION_VENDOR', 'SELECTION_ASHRAM', 'SELECTION_LOCAL_WELFARE', 'PAYMENT_DETAILS', 'BANK_REMINDER', 'PAYMENT_REMINDER', 'POST_PAYMENT');

-- CreateEnum
CREATE TYPE "stalls"."StallEmailStatus" AS ENUM ('SENT', 'FAILED');

-- AlterTable
ALTER TABLE "stalls"."stall" ADD COLUMN     "cluster" TEXT;

-- AlterTable
ALTER TABLE "stalls"."stall_charge_config" ADD COLUMN     "chair_replacement_paise" INTEGER NOT NULL DEFAULT 50000,
ADD COLUMN     "event_days" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "table_replacement_paise" INTEGER NOT NULL DEFAULT 150000,
ADD COLUMN     "vendor_chair_rate_paise" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "vendor_table_rate_paise" INTEGER NOT NULL DEFAULT 40000;

-- CreateTable
CREATE TABLE "stalls"."stall_edition_links" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "staff_registration_url" TEXT,
    "fssai_process_url" TEXT,
    "terms_url" TEXT,
    "finance_email" TEXT,
    "bank_instructions" TEXT,

    CONSTRAINT "stall_edition_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_email_template" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "key" "stalls"."StallEmailTemplateKey" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_key" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "stall_email_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_email_log" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "template_key" "stalls"."StallEmailTemplateKey" NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "stalls"."StallEmailStatus" NOT NULL,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" TEXT NOT NULL,

    CONSTRAINT "stall_email_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_bank_details" (
    "request_id" UUID NOT NULL,
    "invoice_name" TEXT NOT NULL,
    "account_holder" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "micr" TEXT,
    "cheque_media_key" TEXT,
    "advance_return_ack" BOOLEAN NOT NULL,
    "pan_number" TEXT NOT NULL,
    "pan_media_key" TEXT,
    "gst_number" TEXT NOT NULL,
    "gst_media_key" TEXT,
    "neft_agreed" BOOLEAN NOT NULL,
    "tnc_agreed" BOOLEAN NOT NULL,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stall_bank_details_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_payment" (
    "request_id" UUID NOT NULL,
    "stall_fee_paise" INTEGER NOT NULL,
    "plug_points_fee_paise" INTEGER NOT NULL,
    "furniture_fee_paise" INTEGER NOT NULL,
    "net_paise" INTEGER NOT NULL,
    "gst_percent" INTEGER NOT NULL,
    "gst_paise" INTEGER NOT NULL,
    "gross_paise" INTEGER NOT NULL,
    "stall_deposit_paise" INTEGER NOT NULL,
    "furniture_deposit_paise" INTEGER NOT NULL,
    "deposit_total_paise" INTEGER NOT NULL,
    "total_payable_paise" INTEGER NOT NULL,
    "quoted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "quoted_by" TEXT NOT NULL,
    "email_sent_at" TIMESTAMPTZ,
    "confirmed_at" TIMESTAMPTZ,
    "confirmed_by" TEXT,
    "credit_date" DATE,
    "reference_no" TEXT,
    "ecollect_code" TEXT,
    "remitter_name" TEXT,
    "mode" TEXT,
    "amount_received_paise" INTEGER,
    "notes" TEXT,

    CONSTRAINT "stall_payment_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_staff_coupon" (
    "request_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "max_staff" INTEGER NOT NULL,
    "registered_count" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "stall_staff_coupon_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fssai" (
    "request_id" UUID NOT NULL,
    "media_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "license_number" TEXT,
    "valid_till" DATE,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ,
    "verified_by" TEXT,
    "rejected_reason" TEXT,

    CONSTRAINT "stall_fssai_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_check_in" (
    "request_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" TEXT NOT NULL,
    "staff_present" INTEGER NOT NULL DEFAULT 0,
    "passes_2w_issued" INTEGER NOT NULL DEFAULT 0,
    "passes_4w_issued" INTEGER NOT NULL DEFAULT 0,
    "passes_staff_issued" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "stall_check_in_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_furniture_ledger" (
    "request_id" UUID NOT NULL,
    "chairs_ordered" INTEGER NOT NULL,
    "tables_ordered" INTEGER NOT NULL,
    "chairs_issued" INTEGER NOT NULL DEFAULT 0,
    "tables_issued" INTEGER NOT NULL DEFAULT 0,
    "extra_chairs" INTEGER NOT NULL DEFAULT 0,
    "extra_tables" INTEGER NOT NULL DEFAULT 0,
    "extra_charge_paise" INTEGER NOT NULL DEFAULT 0,
    "cash_collected_paise" INTEGER NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ,
    "issued_by" TEXT,
    "chairs_returned" INTEGER,
    "tables_returned" INTEGER,
    "chairs_missing" INTEGER NOT NULL DEFAULT 0,
    "tables_missing" INTEGER NOT NULL DEFAULT 0,
    "chairs_damaged" INTEGER NOT NULL DEFAULT 0,
    "tables_damaged" INTEGER NOT NULL DEFAULT 0,
    "returned_at" TIMESTAMPTZ,
    "returned_by" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "stall_furniture_ledger_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fine" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "fine_type_id" UUID,
    "reason" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "levied_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "levied_by" TEXT NOT NULL,
    "waived_at" TIMESTAMPTZ,
    "waived_by" TEXT,

    CONSTRAINT "stall_fine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_refund" (
    "request_id" UUID NOT NULL,
    "deposit_total_paise" INTEGER NOT NULL,
    "furniture_deduction_paise" INTEGER NOT NULL,
    "fines_paise" INTEGER NOT NULL,
    "refundable_paise" INTEGER NOT NULL,
    "shortfall_paise" INTEGER NOT NULL DEFAULT 0,
    "prepared_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prepared_by" TEXT NOT NULL,
    "sent_to_finance_at" TIMESTAMPTZ,
    "paid_at" TIMESTAMPTZ,
    "paid_by" TEXT,
    "reference_no" TEXT,

    CONSTRAINT "stall_refund_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_edition_links_edition_id_key" ON "stalls"."stall_edition_links"("edition_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_email_template_edition_id_key_key" ON "stalls"."stall_email_template"("edition_id", "key");

-- CreateIndex
CREATE INDEX "stall_email_log_request_id_template_key_status_idx" ON "stalls"."stall_email_log"("request_id", "template_key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "stall_staff_coupon_code_key" ON "stalls"."stall_staff_coupon"("code");

-- CreateIndex
CREATE INDEX "stall_fine_request_id_idx" ON "stalls"."stall_fine"("request_id");

-- AddForeignKey
ALTER TABLE "stalls"."stall_edition_links" ADD CONSTRAINT "stall_edition_links_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_email_template" ADD CONSTRAINT "stall_email_template_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_email_log" ADD CONSTRAINT "stall_email_log_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_bank_details" ADD CONSTRAINT "stall_bank_details_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_payment" ADD CONSTRAINT "stall_payment_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_staff_coupon" ADD CONSTRAINT "stall_staff_coupon_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fssai" ADD CONSTRAINT "stall_fssai_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_check_in" ADD CONSTRAINT "stall_check_in_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_furniture_ledger" ADD CONSTRAINT "stall_furniture_ledger_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fine" ADD CONSTRAINT "stall_fine_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fine" ADD CONSTRAINT "stall_fine_fine_type_id_fkey" FOREIGN KEY ("fine_type_id") REFERENCES "stalls"."stall_fine_type"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_refund" ADD CONSTRAINT "stall_refund_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
