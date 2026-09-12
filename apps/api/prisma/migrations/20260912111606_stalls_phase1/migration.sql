-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "foundation";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "stalls";

-- CreateEnum
CREATE TYPE "stalls"."StallRequestType" AS ENUM ('ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR');

-- CreateEnum
CREATE TYPE "stalls"."StallType" AS ENUM ('FOOD', 'NON_FOOD');

-- CreateEnum
CREATE TYPE "stalls"."StallCategory" AS ENUM ('VENDOR_FOOD', 'ASHRAM_FOOD', 'LW_FOOD', 'VENDOR_NON_FOOD', 'ASHRAM_NON_FOOD', 'HELP_DESK', 'BACKUP');

-- CreateEnum
CREATE TYPE "stalls"."StallRequestStatus" AS ENUM ('SUBMITTED', 'SHORTLISTED', 'SELECTED', 'BACKUP', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "stalls"."StallStage" AS ENUM ('NEW', 'BANK_FORM_SENT', 'BANK_FORM_FILLED', 'PAYMENT_SENT', 'PAYMENT_CONFIRMED', 'FSSAI_PENDING', 'READY', 'CHECKED_IN');

-- CreateEnum
CREATE TYPE "stalls"."StallStatus" AS ENUM ('AVAILABLE', 'ALLOCATED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "stalls"."StallZoneGroup" AS ENUM ('AB', 'C', 'CLOSED');

-- CreateEnum
CREATE TYPE "stalls"."StallFormType" AS ENUM ('ASHRAM', 'ASHRAM_FOOD', 'LOCAL_WELFARE', 'VENDOR', 'BANK', 'FSSAI');

-- CreateEnum
CREATE TYPE "stalls"."StallAccessPurpose" AS ENUM ('STATUS', 'BANK_FORM', 'FSSAI_UPLOAD', 'STAFF_REGISTRATION');

-- CreateEnum
CREATE TYPE "stalls"."StallAshramUsage" AS ENUM ('DEPT_DISPLAY', 'DEPT_SALES', 'VENDOR_SALES', 'SPONSOR', 'OTHER');

-- CreateTable
CREATE TABLE "foundation"."person" (
    "person_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "sign_in_disabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "person_pkey" PRIMARY KEY ("person_id")
);

-- CreateTable
CREATE TABLE "foundation"."activity_trail" (
    "id" UUID NOT NULL,
    "actor_ref" TEXT NOT NULL,
    "module_key" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_trail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_edition" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_edition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_zone" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "expected_crowd" INTEGER NOT NULL DEFAULT 0,
    "is_closed_to_vendors" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "stall_zone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_zone_plan" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "category" "stalls"."StallCategory" NOT NULL,
    "planned_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "stall_zone_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall" (
    "id" UUID NOT NULL,
    "zone_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "category" "stalls"."StallCategory" NOT NULL,
    "status" "stalls"."StallStatus" NOT NULL DEFAULT 'AVAILABLE',

    CONSTRAINT "stall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_rate_card" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "zone_group" "stalls"."StallZoneGroup" NOT NULL,
    "is_food" BOOLEAN NOT NULL,
    "amount_paise" INTEGER NOT NULL,

    CONSTRAINT "stall_rate_card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_charge_config" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "chair_rate_paise" INTEGER NOT NULL,
    "table_rate_paise" INTEGER NOT NULL,
    "lw_chair_rate_paise" INTEGER NOT NULL,
    "lw_table_rate_paise" INTEGER NOT NULL,
    "vendor_deposit_paise" INTEGER NOT NULL,
    "local_welfare_deposit_paise" INTEGER NOT NULL,
    "plug_5a_rate_paise" INTEGER NOT NULL,
    "plug_15a_rate_paise" INTEGER NOT NULL,
    "gst_percent" INTEGER NOT NULL DEFAULT 18,
    "crowd_per_stall" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "stall_charge_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_fine_type" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "default_amount_paise" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stall_fine_type_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_custom_field" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "form_type" "stalls"."StallFormType" NOT NULL,
    "label" TEXT NOT NULL,
    "label_ta" TEXT,
    "field_type" TEXT NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stall_custom_field_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_flow_config" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "bank_step_enabled" BOOLEAN NOT NULL DEFAULT true,
    "payment_step_enabled" BOOLEAN NOT NULL DEFAULT true,
    "fssai_step_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "stall_flow_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_account" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_access_link" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "request_id" UUID,
    "purpose" "stalls"."StallAccessPurpose" NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "revoked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_access_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_staff_role" (
    "id" UUID NOT NULL,
    "person_ref" TEXT NOT NULL,
    "role_key" TEXT NOT NULL,
    "granted_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stall_staff_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_reference_sequence" (
    "edition_id" UUID NOT NULL,
    "request_type" "stalls"."StallRequestType" NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stall_reference_sequence_pkey" PRIMARY KEY ("edition_id","request_type")
);

-- CreateTable
CREATE TABLE "stalls"."stall_request" (
    "id" UUID NOT NULL,
    "edition_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "request_type" "stalls"."StallRequestType" NOT NULL,
    "stall_type" "stalls"."StallType" NOT NULL,
    "stall_name" TEXT NOT NULL,
    "requester_name" TEXT NOT NULL,
    "contact_number" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "items_selling" TEXT NOT NULL,
    "num_stalls_requested" INTEGER NOT NULL,
    "preferred_zone_code" TEXT NOT NULL,
    "remarks" TEXT,
    "plugs_5a" INTEGER NOT NULL DEFAULT 0,
    "plugs_15a" INTEGER NOT NULL DEFAULT 0,
    "gas_stoves" INTEGER NOT NULL DEFAULT 0,
    "tables_needed" INTEGER NOT NULL DEFAULT 0,
    "chairs_needed" INTEGER NOT NULL DEFAULT 0,
    "passes_2w" INTEGER NOT NULL DEFAULT 0,
    "passes_4w" INTEGER NOT NULL DEFAULT 0,
    "passes_staff" INTEGER NOT NULL DEFAULT 0,
    "agreed_at" TIMESTAMPTZ NOT NULL,
    "deposit_acknowledged_at" TIMESTAMPTZ,
    "status" "stalls"."StallRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "stage" "stalls"."StallStage" NOT NULL DEFAULT 'NEW',
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "flagged_at" TIMESTAMPTZ,
    "flag_reason" TEXT,
    "reject_reason" TEXT,

    CONSTRAINT "stall_request_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_request_ashram_detail" (
    "request_id" UUID NOT NULL,
    "department_head" TEXT NOT NULL,
    "department_head_contact" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "requester_contact" TEXT NOT NULL,
    "credit_card_needed" BOOLEAN NOT NULL,
    "usage" "stalls"."StallAshramUsage" NOT NULL,
    "usage_other" TEXT,
    "wants_thembu" BOOLEAN NOT NULL,
    "fssai_expected" BOOLEAN,

    CONSTRAINT "stall_request_ashram_detail_pkey" PRIMARY KEY ("request_id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_request_appliance" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "watts" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "stall_request_appliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_custom_field_value" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "custom_field_id" UUID NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "stall_custom_field_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stalls"."stall_allocation" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "stall_id" UUID NOT NULL,
    "active_stall_id" UUID,
    "allocated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allocated_by" TEXT NOT NULL,
    "released_at" TIMESTAMPTZ,
    "released_by" TEXT,

    CONSTRAINT "stall_allocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "person_email_key" ON "foundation"."person"("email");

-- CreateIndex
CREATE INDEX "activity_trail_module_key_subject_ref_idx" ON "foundation"."activity_trail"("module_key", "subject_ref");

-- CreateIndex
CREATE UNIQUE INDEX "stall_edition_year_key" ON "stalls"."stall_edition"("year");

-- CreateIndex
CREATE UNIQUE INDEX "stall_zone_edition_id_code_key" ON "stalls"."stall_zone"("edition_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "stall_zone_plan_zone_id_category_key" ON "stalls"."stall_zone_plan"("zone_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "stall_zone_id_number_key" ON "stalls"."stall"("zone_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "stall_rate_card_edition_id_zone_group_is_food_key" ON "stalls"."stall_rate_card"("edition_id", "zone_group", "is_food");

-- CreateIndex
CREATE UNIQUE INDEX "stall_charge_config_edition_id_key" ON "stalls"."stall_charge_config"("edition_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_fine_type_edition_id_reason_key" ON "stalls"."stall_fine_type"("edition_id", "reason");

-- CreateIndex
CREATE INDEX "stall_custom_field_edition_id_form_type_idx" ON "stalls"."stall_custom_field"("edition_id", "form_type");

-- CreateIndex
CREATE UNIQUE INDEX "stall_flow_config_edition_id_key" ON "stalls"."stall_flow_config"("edition_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_account_email_key" ON "stalls"."stall_account"("email");

-- CreateIndex
CREATE UNIQUE INDEX "stall_access_link_token_hash_key" ON "stalls"."stall_access_link"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "stall_staff_role_person_ref_role_key_key" ON "stalls"."stall_staff_role"("person_ref", "role_key");

-- CreateIndex
CREATE UNIQUE INDEX "stall_request_reference_key" ON "stalls"."stall_request"("reference");

-- CreateIndex
CREATE INDEX "stall_request_edition_id_status_stage_idx" ON "stalls"."stall_request"("edition_id", "status", "stage");

-- CreateIndex
CREATE INDEX "stall_request_edition_id_request_type_idx" ON "stalls"."stall_request"("edition_id", "request_type");

-- CreateIndex
CREATE INDEX "stall_request_submitted_at_id_idx" ON "stalls"."stall_request"("submitted_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "stall_request_appliance_request_id_idx" ON "stalls"."stall_request_appliance"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_custom_field_value_request_id_custom_field_id_key" ON "stalls"."stall_custom_field_value"("request_id", "custom_field_id");

-- CreateIndex
CREATE UNIQUE INDEX "stall_allocation_active_stall_id_key" ON "stalls"."stall_allocation"("active_stall_id");

-- CreateIndex
CREATE INDEX "stall_allocation_request_id_idx" ON "stalls"."stall_allocation"("request_id");

-- AddForeignKey
ALTER TABLE "stalls"."stall_zone" ADD CONSTRAINT "stall_zone_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_zone_plan" ADD CONSTRAINT "stall_zone_plan_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "stalls"."stall_zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall" ADD CONSTRAINT "stall_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "stalls"."stall_zone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_rate_card" ADD CONSTRAINT "stall_rate_card_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_charge_config" ADD CONSTRAINT "stall_charge_config_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_fine_type" ADD CONSTRAINT "stall_fine_type_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_custom_field" ADD CONSTRAINT "stall_custom_field_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_flow_config" ADD CONSTRAINT "stall_flow_config_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_access_link" ADD CONSTRAINT "stall_access_link_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "stalls"."stall_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_access_link" ADD CONSTRAINT "stall_access_link_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_reference_sequence" ADD CONSTRAINT "stall_reference_sequence_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_request" ADD CONSTRAINT "stall_request_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_request" ADD CONSTRAINT "stall_request_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "stalls"."stall_account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_request_ashram_detail" ADD CONSTRAINT "stall_request_ashram_detail_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_request_appliance" ADD CONSTRAINT "stall_request_appliance_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_custom_field_value" ADD CONSTRAINT "stall_custom_field_value_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_custom_field_value" ADD CONSTRAINT "stall_custom_field_value_custom_field_id_fkey" FOREIGN KEY ("custom_field_id") REFERENCES "stalls"."stall_custom_field"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_allocation" ADD CONSTRAINT "stall_allocation_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_allocation" ADD CONSTRAINT "stall_allocation_stall_id_fkey" FOREIGN KEY ("stall_id") REFERENCES "stalls"."stall"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_allocation" ADD CONSTRAINT "stall_allocation_active_stall_id_fkey" FOREIGN KEY ("active_stall_id") REFERENCES "stalls"."stall"("id") ON DELETE SET NULL ON UPDATE CASCADE;
