-- Drop existing non-unique index created in the previous migration
DROP INDEX IF EXISTS "PlatformAccount_coreUserId_idx";

-- CreateUniqueIndex: required for one-to-one relation between PlatformAccount and User
CREATE UNIQUE INDEX "PlatformAccount_coreUserId_key" ON "PlatformAccount"("coreUserId");
