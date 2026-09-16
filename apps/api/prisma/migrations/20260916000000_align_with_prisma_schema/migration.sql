-- DropForeignKey
ALTER TABLE "stalls"."stall_declaration" DROP CONSTRAINT "stall_declaration_edition_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_declaration_consent" DROP CONSTRAINT "stall_declaration_consent_declaration_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_declaration_consent" DROP CONSTRAINT "stall_declaration_consent_request_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_form_definition" DROP CONSTRAINT "stall_form_definition_edition_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_form_field" DROP CONSTRAINT "stall_form_field_definition_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_form_field" DROP CONSTRAINT "stall_form_field_section_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_form_section" DROP CONSTRAINT "stall_form_section_definition_id_fkey";

-- DropIndex
DROP INDEX "stalls"."stall_declaration_version";

-- AlterTable
ALTER TABLE "stalls"."stall_declaration" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stalls"."stall_declaration_consent" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stalls"."stall_form_definition" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "stalls"."stall_form_section" ALTER COLUMN "id" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "stalls"."stall_declaration" ADD CONSTRAINT "stall_declaration_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_declaration_consent" ADD CONSTRAINT "stall_declaration_consent_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_declaration_consent" ADD CONSTRAINT "stall_declaration_consent_declaration_id_fkey" FOREIGN KEY ("declaration_id") REFERENCES "stalls"."stall_declaration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_form_definition" ADD CONSTRAINT "stall_form_definition_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_form_section" ADD CONSTRAINT "stall_form_section_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "stalls"."stall_form_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_form_field" ADD CONSTRAINT "stall_form_field_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "stalls"."stall_form_definition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_form_field" ADD CONSTRAINT "stall_form_field_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "stalls"."stall_form_section"("id") ON DELETE SET NULL ON UPDATE CASCADE;
