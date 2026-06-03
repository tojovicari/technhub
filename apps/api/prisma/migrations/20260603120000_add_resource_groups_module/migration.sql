-- CreateEnum
CREATE TYPE "ResourceGroupResourceRole" AS ENUM ('primary', 'supporting', 'shared');

-- CreateEnum
CREATE TYPE "ResourceWeightMode" AS ENUM ('auto', 'manual');

-- CreateEnum
CREATE TYPE "ResourceGroupTeamRole" AS ENUM ('owner', 'contributor', 'platform');

-- CreateEnum
CREATE TYPE "ResourceMetricType" AS ENUM ('dora', 'sla', 'cogs', 'health');

-- CreateTable
CREATE TABLE "ResourceGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProjectStatus" NOT NULL DEFAULT 'planning',
    "ownerUserId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceGroupResource" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceGroupId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "role" "ResourceGroupResourceRole" NOT NULL DEFAULT 'shared',
    "weightMode" "ResourceWeightMode" NOT NULL DEFAULT 'auto',
    "manualWeight" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceGroupResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceGroupTeam" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceGroupId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "ResourceGroupTeamRole" NOT NULL DEFAULT 'contributor',
    "allocationPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResourceGroupTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceGroupMetricSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "resourceGroupId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "metricType" "ResourceMetricType" NOT NULL,
    "payload" JSONB NOT NULL,
    "lineage" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ResourceGroupMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResourceGroup_tenantId_key_key" ON "ResourceGroup"("tenantId", "key");

-- CreateIndex
CREATE INDEX "ResourceGroup_tenantId_idx" ON "ResourceGroup"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceGroupResource_resourceGroupId_projectId_key" ON "ResourceGroupResource"("resourceGroupId", "projectId");

-- CreateIndex
CREATE INDEX "ResourceGroupResource_tenantId_idx" ON "ResourceGroupResource"("tenantId");

-- CreateIndex
CREATE INDEX "ResourceGroupResource_projectId_idx" ON "ResourceGroupResource"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceGroupTeam_resourceGroupId_teamId_key" ON "ResourceGroupTeam"("resourceGroupId", "teamId");

-- CreateIndex
CREATE INDEX "ResourceGroupTeam_tenantId_idx" ON "ResourceGroupTeam"("tenantId");

-- CreateIndex
CREATE INDEX "ResourceGroupTeam_teamId_idx" ON "ResourceGroupTeam"("teamId");

-- CreateIndex
CREATE INDEX "ResourceGroupMetricSnapshot_tenantId_resourceGroupId_idx" ON "ResourceGroupMetricSnapshot"("tenantId", "resourceGroupId");

-- CreateIndex
CREATE INDEX "ResourceGroupMetricSnapshot_metricType_periodKey_idx" ON "ResourceGroupMetricSnapshot"("metricType", "periodKey");

-- AddForeignKey
ALTER TABLE "ResourceGroup" ADD CONSTRAINT "ResourceGroup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroup" ADD CONSTRAINT "ResourceGroup_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupResource" ADD CONSTRAINT "ResourceGroupResource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupResource" ADD CONSTRAINT "ResourceGroupResource_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "ResourceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupResource" ADD CONSTRAINT "ResourceGroupResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupTeam" ADD CONSTRAINT "ResourceGroupTeam_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupTeam" ADD CONSTRAINT "ResourceGroupTeam_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "ResourceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupTeam" ADD CONSTRAINT "ResourceGroupTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupMetricSnapshot" ADD CONSTRAINT "ResourceGroupMetricSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceGroupMetricSnapshot" ADD CONSTRAINT "ResourceGroupMetricSnapshot_resourceGroupId_fkey" FOREIGN KEY ("resourceGroupId") REFERENCES "ResourceGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
