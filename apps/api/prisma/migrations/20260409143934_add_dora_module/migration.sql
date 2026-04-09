-- CreateEnum
CREATE TYPE "DoraLevel" AS ENUM ('elite', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "DeployEventSource" AS ENUM ('github_release', 'github_tag', 'manual');

-- CreateTable
CREATE TABLE "DeployEvent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "source" "DeployEventSource" NOT NULL DEFAULT 'github_release',
    "externalId" TEXT,
    "ref" TEXT NOT NULL,
    "commitSha" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "deployedAt" TIMESTAMP(3) NOT NULL,
    "isHotfix" BOOLEAN NOT NULL DEFAULT false,
    "isRollback" BOOLEAN NOT NULL DEFAULT false,
    "prIds" TEXT[],
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeployEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthMetric" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT,
    "teamId" TEXT,
    "metricName" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 30,
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "level" "DoraLevel",
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "HealthMetric_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeployEvent_tenantId_idx" ON "DeployEvent"("tenantId");

-- CreateIndex
CREATE INDEX "DeployEvent_tenantId_deployedAt_idx" ON "DeployEvent"("tenantId", "deployedAt");

-- CreateIndex
CREATE INDEX "DeployEvent_projectId_idx" ON "DeployEvent"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "DeployEvent_tenantId_source_externalId_key" ON "DeployEvent"("tenantId", "source", "externalId");

-- CreateIndex
CREATE INDEX "HealthMetric_tenantId_metricName_idx" ON "HealthMetric"("tenantId", "metricName");

-- CreateIndex
CREATE INDEX "HealthMetric_tenantId_projectId_metricName_idx" ON "HealthMetric"("tenantId", "projectId", "metricName");

-- CreateIndex
CREATE INDEX "HealthMetric_computedAt_idx" ON "HealthMetric"("computedAt");
