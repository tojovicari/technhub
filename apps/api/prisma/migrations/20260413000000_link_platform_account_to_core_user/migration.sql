-- AlterTable: add coreUserId to PlatformAccount
ALTER TABLE "PlatformAccount" ADD COLUMN "coreUserId" TEXT;

-- CreateIndex
CREATE INDEX "PlatformAccount_coreUserId_idx" ON "PlatformAccount"("coreUserId");

-- AddForeignKey
ALTER TABLE "PlatformAccount" ADD CONSTRAINT "PlatformAccount_coreUserId_fkey" FOREIGN KEY ("coreUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill existing accounts: match by email within the same tenant
UPDATE "PlatformAccount" pa
SET "coreUserId" = u.id
FROM "User" u
WHERE pa.email = u.email
  AND pa."tenantId" = u."tenantId"
  AND pa."coreUserId" IS NULL;
