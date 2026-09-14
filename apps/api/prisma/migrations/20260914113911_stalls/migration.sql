-- DropForeignKey
ALTER TABLE "stalls"."stall" DROP CONSTRAINT "stall_category_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_contract_signature" DROP CONSTRAINT "stall_contract_signature_request_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_plan_category" DROP CONSTRAINT "stall_plan_category_edition_id_fkey";

-- DropForeignKey
ALTER TABLE "stalls"."stall_zone_plan" DROP CONSTRAINT "stall_zone_plan_category_id_fkey";

-- AddForeignKey
ALTER TABLE "stalls"."stall_plan_category" ADD CONSTRAINT "stall_plan_category_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "stalls"."stall_edition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_zone_plan" ADD CONSTRAINT "stall_zone_plan_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "stalls"."stall_plan_category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall" ADD CONSTRAINT "stall_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "stalls"."stall_plan_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stalls"."stall_contract_signature" ADD CONSTRAINT "stall_contract_signature_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "stalls"."stall_request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
