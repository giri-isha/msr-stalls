-- CreateEnum
CREATE TYPE "stalls"."StallLoginKind" AS ENUM ('EMAIL', 'MOBILE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "stalls"."StallAccessPurpose" ADD VALUE 'SESSION';
ALTER TYPE "stalls"."StallAccessPurpose" ADD VALUE 'REGISTER_CONFIRM';
ALTER TYPE "stalls"."StallAccessPurpose" ADD VALUE 'PASSWORD_RESET';

-- CreateTable
CREATE TABLE "stalls"."stall_credential" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "login_value" TEXT NOT NULL,
    "login_kind" "stalls"."StallLoginKind" NOT NULL,
    "password_hash" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "stall_credential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stall_credential_login_value_key" ON "stalls"."stall_credential"("login_value");

-- AddForeignKey
ALTER TABLE "stalls"."stall_credential" ADD CONSTRAINT "stall_credential_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "stalls"."stall_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
