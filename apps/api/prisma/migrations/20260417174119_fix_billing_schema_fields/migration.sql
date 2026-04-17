/*
  Warnings:

  - You are about to drop the column `attempts` on the `PurgeFailureQueue` table. All the data in the column will be lost.
  - You are about to drop the column `endedAt` on the `SubscriptionHistory` table. All the data in the column will be lost.
  - You are about to drop the column `startedAt` on the `SubscriptionHistory` table. All the data in the column will be lost.
  - You are about to drop the column `tenantId` on the `SubscriptionHistory` table. All the data in the column will be lost.
  - Added the required column `effectiveFrom` to the `SubscriptionHistory` table without a default value. This is not possible if the table is not empty.
  - Added the required column `subscriptionId` to the `SubscriptionHistory` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "PurgeFailureQueue_createdAt_idx";

-- DropIndex
DROP INDEX "SubscriptionHistory_endedAt_idx";

-- DropIndex
DROP INDEX "SubscriptionHistory_tenantId_startedAt_idx";

-- AlterTable
ALTER TABLE "PurgeFailureQueue" DROP COLUMN "attempts",
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SubscriptionHistory" DROP COLUMN "endedAt",
DROP COLUMN "startedAt",
DROP COLUMN "tenantId",
ADD COLUMN     "effectiveFrom" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "subscriptionId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PurgeFailureQueue_nextRetryAt_idx" ON "PurgeFailureQueue"("nextRetryAt");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_subscriptionId_effectiveFrom_idx" ON "SubscriptionHistory"("subscriptionId", "effectiveFrom");
