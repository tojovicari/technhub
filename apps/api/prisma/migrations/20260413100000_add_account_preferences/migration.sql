-- AlterTable: add preferences jsonb column to PlatformAccount
ALTER TABLE "PlatformAccount" ADD COLUMN "preferences" JSONB;
