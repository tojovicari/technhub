-- CreateEnum
CREATE TYPE "PlatformSuperRole" AS ENUM ('super_admin', 'platform_admin');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'downgraded', 'cancelled', 'expired');

-- AlterTable
ALTER TABLE "PlatformAccount" ADD COLUMN     "platformRole" "PlatformSuperRole";

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "billingPeriod" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "modules" TEXT[],
    "maxSeats" INTEGER,
    "maxIntegrations" INTEGER,
    "historyDays" INTEGER,
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB NOT NULL DEFAULT '{}',
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "scheduledDowngradePlanId" TEXT,
    "pendingPlanChanges" JSONB,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'active',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "pastDueSince" TIMESTAMP(3),
    "downgradedAt" TIMESTAMP(3),
    "dataDeletionScheduledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerSubscriptionId" TEXT,
    "providerCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionHistory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanTenantAssignment" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanTenantAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "provider" TEXT,
    "providerEventId" TEXT,
    "rawPayload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurgeFailureQueue" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "error" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "PurgeFailureQueue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_name_key" ON "Plan"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_pastDueSince_idx" ON "Subscription"("pastDueSince");

-- CreateIndex
CREATE INDEX "Subscription_dataDeletionScheduledAt_idx" ON "Subscription"("dataDeletionScheduledAt");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_tenantId_startedAt_idx" ON "SubscriptionHistory"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "SubscriptionHistory_endedAt_idx" ON "SubscriptionHistory"("endedAt");

-- CreateIndex
CREATE INDEX "PlanTenantAssignment_tenantId_idx" ON "PlanTenantAssignment"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PlanTenantAssignment_planId_tenantId_key" ON "PlanTenantAssignment"("planId", "tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingEvent_providerEventId_key" ON "BillingEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "BillingEvent_tenantId_idx" ON "BillingEvent"("tenantId");

-- CreateIndex
CREATE INDEX "BillingEvent_occurredAt_idx" ON "BillingEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "BillingEvent_providerEventId_idx" ON "BillingEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PurgeFailureQueue_tenantId_idx" ON "PurgeFailureQueue"("tenantId");

-- CreateIndex
CREATE INDEX "PurgeFailureQueue_createdAt_idx" ON "PurgeFailureQueue"("createdAt");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_scheduledDowngradePlanId_fkey" FOREIGN KEY ("scheduledDowngradePlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionHistory" ADD CONSTRAINT "SubscriptionHistory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanTenantAssignment" ADD CONSTRAINT "PlanTenantAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
