-- CreateEnum
CREATE TYPE "stalls"."StallTemplateKey" AS ENUM ('SELECTION_VENDOR', 'SELECTION_ASHRAM', 'PAYMENT_DETAILS', 'ONBOARDING_FSSAI_STAFF');

-- CreateEnum
CREATE TYPE "stalls"."StallPaymentPurpose" AS ENUM ('RENT', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "stalls"."StallPaymentMode" AS ENUM ('NEFT', 'CASH', 'CHEQUE', 'UPI', 'OTHER');

-- CreateEnum
CREATE TYPE "stalls"."StallReminderKind" AS ENUM ('BANK', 'PAYMENT');

-- CreateEnum
CREATE TYPE "stalls"."StallIdType" AS ENUM ('AADHAAR', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT', 'OTHER');

-- AlterTable
ALTER TABLE "stalls"."stall_charge_config" ADD COLUMN     "chair_replacement_paise" INTEGER NOT NULL DEFAULT 40000,
ADD COLUMN     "chair_table_deposit_paise" INTEGER NOT NULL DEFAULT 400000,
ADD COLUMN     "damage_penalty_paise" INTEGER NOT NULL DEFAULT 25000,
ADD COLUMN     "equipment_days" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "table_replacement_paise" INTEGER NOT NULL DEFAULT 90000;

-- CreateTable
CREATE TABLE "stalls"."stall_email_template" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "key" "stalls"."StallTemplateKey" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachment_key" TEXT,
    "attachment_name" TEXT,
    "attachment_bytes" INTEGER,
    "updated_at" TIMESTAMPTZ,
    "updated_by" TEXT,

    CONSTRAINT "stall_email_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_email_log" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "template_key" "stalls"."StallTemplateKey" NOT NULL,
    "to_email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_by" TEXT NOT NULL,

    CONSTRAINT "stall_email_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_bank_detail" (
    "request_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
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
    "pan_number" TEXT NOT NULL,
    "gst_number" TEXT NOT NULL,
    "cheque_key" TEXT NOT NULL,
    "pan_key" TEXT NOT NULL,
    "gst_key" TEXT,
    "agreed_neft_at" TIMESTAMPTZ NOT NULL,
    "agreed_terms_at" TIMESTAMPTZ NOT NULL,
    "remarks" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_bank_detail_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_reminder_call" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "kind" "stalls"."StallReminderKind" NOT NULL,
    "note" TEXT,
    "called_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_by" TEXT NOT NULL,

    CONSTRAINT "stall_reminder_call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_payment_plan" (
    "request_id" UUID NOT NULL,
    "stall_fee_paise" INTEGER NOT NULL,
    "plug_fee_paise" INTEGER NOT NULL,
    "equipment_fee_paise" INTEGER NOT NULL,
    "net_paise" INTEGER NOT NULL,
    "gst_paise" INTEGER NOT NULL,
    "fee_total_paise" INTEGER NOT NULL,
    "stall_deposit_paise" INTEGER NOT NULL,
    "equipment_deposit_paise" INTEGER NOT NULL,
    "deposit_total_paise" INTEGER NOT NULL,
    "quoted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_payment_plan_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_payment_record" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "purpose" "stalls"."StallPaymentPurpose" NOT NULL,
    "reference_no" TEXT NOT NULL,
    "e_collect_code" TEXT,
    "amount_paise" INTEGER NOT NULL,
    "received_on" DATE NOT NULL,
    "remitter_name" TEXT,
    "mode" "stalls"."StallPaymentMode" NOT NULL DEFAULT 'NEFT',
    "note" TEXT,
    "confirmed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" TEXT NOT NULL,

    CONSTRAINT "stall_payment_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_staff_coupon" (
    "request_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "stall_staff_coupon_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_vendor_staff" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "id_type" "stalls"."StallIdType" NOT NULL,
    "id_number" TEXT NOT NULL,
    "role" TEXT,
    "registered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_vendor_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fssai_certificate" (
    "request_id" UUID NOT NULL,
    "owner_name" TEXT,
    "mobile" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMPTZ,
    "verified_by" TEXT,

    CONSTRAINT "stall_fssai_certificate_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fssai_file" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_fssai_file_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_check_in" (
    "request_id" UUID NOT NULL,
    "checked_in_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_by" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "stall_check_in_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_equipment_issue" (
    "request_id" UUID NOT NULL,
    "chairs_requested" INTEGER NOT NULL,
    "tables_requested" INTEGER NOT NULL,
    "extra_chairs" INTEGER NOT NULL DEFAULT 0,
    "extra_tables" INTEGER NOT NULL DEFAULT 0,
    "extra_charge_paise" INTEGER NOT NULL DEFAULT 0,
    "extra_collected_at" TIMESTAMPTZ,
    "distributed_at" TIMESTAMPTZ,
    "distributed_by" TEXT,
    "collected_at" TIMESTAMPTZ,
    "collected_by" TEXT,
    "missing_chairs" INTEGER NOT NULL DEFAULT 0,
    "missing_tables" INTEGER NOT NULL DEFAULT 0,
    "damaged" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stall_equipment_issue_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fine" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "fine_type_id" UUID,
    "reason" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT NOT NULL,

    CONSTRAINT "stall_fine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_refund" (
    "request_id" UUID NOT NULL,
    "deposit_held_paise" INTEGER NOT NULL,
    "equipment_deduction_paise" INTEGER NOT NULL,
    "fine_deduction_paise" INTEGER NOT NULL,
    "refund_due_paise" INTEGER NOT NULL,
    "shortfall_paise" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "voucher_ref" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_by" TEXT NOT NULL,

    CONSTRAINT "stall_refund_pkey" PRIMARY KEY ("request_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_email_template_edition_id_key_key" ON "stalls"."stall_email_template"("edition_id", "key");

-- CreateIndex
CREATE INDEX "stall_email_log_template_key_sent_at_idx" ON "stalls"."stall_email_log"("template_key", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "stall_email_log_request_id_template_key_key" ON "stalls"."stall_email_log"("request_id", "template_key");

-- CreateIndex
CREATE INDEX "stall_reminder_call_request_id_kind_idx" ON "stalls"."stall_reminder_call"("request_id", "kind");

-- CreateIndex
CREATE INDEX "stall_payment_record_request_id_idx" ON "stalls"."stall_payment_record"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_payment_record_request_id_reference_no_key" ON "stalls"."stall_payment_record"("request_id", "reference_no");

-- CreateIndex
CREATE UNIQUE INDEX "stall_staff_coupon_code_key" ON "stalls"."stall_staff_coupon"("code");

-- CreateIndex
CREATE INDEX "stall_vendor_staff_request_id_idx" ON "stalls"."stall_vendor_staff"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_vendor_staff_request_id_mobile_key" ON "stalls"."stall_vendor_staff"("request_id", "mobile");

-- CreateIndex
CREATE INDEX "stall_fssai_file_request_id_idx" ON "stalls"."stall_fssai_file"("request_id");

-- CreateIndex
CREATE INDEX "stall_fine_request_id_idx" ON "stalls"."stall_fine"("request_id");

-- AddForeignKey
ALTER TABLE "stalls"."stall_email_template" ADD CONSTRAINT "stall_email_template_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_email_log" ADD CONSTRAINT "stall_email_log_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_bank_detail" ADD CONSTRAINT "stall_bank_detail_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_reminder_call" ADD CONSTRAINT "stall_reminder_call_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_payment_plan" ADD CONSTRAINT "stall_payment_plan_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_payment_record" ADD CONSTRAINT "stall_payment_record_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_staff_coupon" ADD CONSTRAINT "stall_staff_coupon_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_vendor_staff" ADD CONSTRAINT "stall_vendor_staff_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fssai_certificate" ADD CONSTRAINT "stall_fssai_certificate_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fssai_file" ADD CONSTRAINT "stall_fssai_file_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_fssai_certificate"("request_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_check_in" ADD CONSTRAINT "stall_check_in_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_equipment_issue" ADD CONSTRAINT "stall_equipment_issue_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fine" ADD CONSTRAINT "stall_fine_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_refund" ADD CONSTRAINT "stall_refund_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
